// Keşif: cihazda (IndexedDB) tutulan kayıt + internet gelince sunucuya
// gönderim. Kimlikler cihazda üretilir; aynı kayıt tekrar gönderilirse
// güncellenir, kopya oluşmaz. Fotoğraflar küçültülüp saklanır.
import { supabase } from "@/integrations/supabase/client";
import { idbAll, idbDelete, idbGet, idbSet } from "@/lib/offline-db";

export const workTypeLabels = {
  ges: "GES",
  sarj: "Şarj istasyonu",
  taahhut: "Elektrik taahhüt",
  siva_alti: "Sıva altı tesisat",
  pano: "Pano",
  aydinlatma: "Aydınlatma",
  og_trafo: "OG / trafo",
  olcum: "Ölçüm / periyodik kontrol",
  diger: "Diğer",
} as const;
export type WorkType = keyof typeof workTypeLabels;

export const surveyUnits = [
  "adet",
  "m",
  "m²",
  "kg",
  "set",
  "boy",
  "takım",
  "saat",
  "gün",
  "kWp",
  "iş",
] as const;

export type SurveyItem = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  catalog_item_id: string | null;
  note: string | null;
};

export type SurveyPhotoMeta = {
  id: string;
  caption: string | null;
  taken_at: string;
  include_in_offer: boolean;
  /** Sunucudaki yol (gönderildiyse). */
  storage_path: string | null;
};

/** Ses notu: internetsiz kaydedilir, internet gelince gönderilir. */
export type SurveyAudioMeta = {
  id: string;
  taken_at: string;
  duration_s: number;
  mime: string;
  storage_path: string | null;
  /** Yazıya dökülmüş hali (varsa). */
  transcript: string | null;
};

export type Survey = {
  id: string;
  survey_no: string | null;
  title: string;
  work_type: WorkType;
  customer_id: string | null;
  customer_name: string | null;
  contact_phone: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  location_accuracy_m: number | null;
  notes: string;
  status: "taslak" | "tamamlandi" | "teklif";
  offer_id: string | null;
  surveyed_at: string;
  items: SurveyItem[];
  photos: SurveyPhotoMeta[];
  audios: SurveyAudioMeta[];
  /** Cihazdaki son değişiklik. */
  local_updated_at: string;
  /** Sunucuya en son başarıyla gönderilen sürüm. */
  synced_at: string | null;
};

type LocalPhoto = {
  id: string;
  survey_id: string;
  blob: Blob;
  synced: boolean;
};

const nowIso = () => new Date().toISOString();

export function newSurvey(): Survey {
  return {
    id: crypto.randomUUID(),
    survey_no: null,
    title: "",
    work_type: "taahhut",
    customer_id: null,
    customer_name: null,
    contact_phone: null,
    location_text: null,
    latitude: null,
    longitude: null,
    location_accuracy_m: null,
    notes: "",
    status: "taslak",
    offer_id: null,
    surveyed_at: nowIso(),
    items: [],
    photos: [],
    audios: [],
    local_updated_at: nowIso(),
    synced_at: null,
  };
}

export const isDirty = (s: Survey) =>
  !s.synced_at || s.local_updated_at > s.synced_at;

// ---------------------------------------------------------------- cihaz

export async function saveLocal(survey: Survey) {
  const next = { ...survey, local_updated_at: nowIso() };
  await idbSet("surveys", survey.id, next);
  return next;
}

/** Eski sürümde kaydedilmiş keşiflerde ses alanı yoktu. */
const normalize = (s: Survey | undefined) =>
  s ? { ...s, audios: s.audios ?? [] } : s;
export const getLocal = async (id: string) =>
  normalize(await idbGet<Survey>("surveys", id));
export const listLocal = async () =>
  (await idbAll<Survey>("surveys")).map((s) => normalize(s) as Survey);

export async function deleteLocal(survey: Survey) {
  for (const p of survey.photos) await idbDelete("photos", p.id);
  for (const a of survey.audios ?? []) await idbDelete("photos", a.id);
  await idbDelete("surveys", survey.id);
}

/** Fotoğrafı en uzun kenarı 1600 px JPEG'e küçültür (tablet fotoğrafı ~5 MB
 * yerine ~300 KB). */
export async function compressImage(file: Blob, maxSide = 1600, quality = 0.8) {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

export async function addPhoto(survey: Survey, file: Blob) {
  const id = crypto.randomUUID();
  const blob = await compressImage(file);
  await idbSet("photos", id, {
    id,
    survey_id: survey.id,
    blob,
    synced: false,
  } satisfies LocalPhoto);
  const meta: SurveyPhotoMeta = {
    id,
    caption: null,
    taken_at: nowIso(),
    include_in_offer: true,
    storage_path: null,
  };
  return saveLocal({ ...survey, photos: [...survey.photos, meta] });
}

export async function removePhoto(survey: Survey, photoId: string) {
  await idbDelete("photos", photoId);
  const photo = survey.photos.find((p) => p.id === photoId);
  if (photo?.storage_path && navigator.onLine) {
    await supabase.storage.from("site-surveys").remove([photo.storage_path]);
    await supabase.from("site_survey_photos").delete().eq("id", photoId);
  }
  return saveLocal({
    ...survey,
    photos: survey.photos.filter((p) => p.id !== photoId),
  });
}

export async function addAudio(survey: Survey, blob: Blob, durationS: number) {
  const id = crypto.randomUUID();
  await idbSet("photos", id, {
    id,
    survey_id: survey.id,
    blob,
    synced: false,
  } satisfies LocalPhoto);
  const meta: SurveyAudioMeta = {
    id,
    taken_at: nowIso(),
    duration_s: Math.max(0, Math.round(durationS)),
    mime: blob.type || "audio/webm",
    storage_path: null,
    transcript: null,
  };
  return saveLocal({ ...survey, audios: [...(survey.audios ?? []), meta] });
}

export async function removeAudio(survey: Survey, audioId: string) {
  await idbDelete("photos", audioId);
  const audio = survey.audios.find((a) => a.id === audioId);
  if (audio?.storage_path && navigator.onLine) {
    await supabase.storage.from("site-surveys").remove([audio.storage_path]);
    await supabase.from("site_survey_photos").delete().eq("id", audioId);
  }
  return saveLocal({
    ...survey,
    audios: survey.audios.filter((a) => a.id !== audioId),
  });
}

/** Ses kaydının çalınacak adresi (cihazdaysa yerel). */
export async function audioUrl(audio: SurveyAudioMeta) {
  const local = await idbGet<LocalPhoto>("photos", audio.id);
  if (local?.blob) return URL.createObjectURL(local.blob);
  if (audio.storage_path && navigator.onLine) {
    const { data } = await supabase.storage
      .from("site-surveys")
      .createSignedUrl(audio.storage_path, 3600);
    return data?.signedUrl ?? null;
  }
  return null;
}

const audioExt = (mime: string) =>
  mime.includes("mp4") || mime.includes("m4a")
    ? "m4a"
    : mime.includes("ogg")
      ? "ogg"
      : mime.includes("mpeg")
        ? "mp3"
        : mime.includes("wav")
          ? "wav"
          : "webm";

/** Fotoğrafın gösterilecek adresi: cihazdaysa yerel, değilse imzalı bağlantı. */
export async function photoUrl(photo: SurveyPhotoMeta) {
  const local = await idbGet<LocalPhoto>("photos", photo.id);
  if (local?.blob) return URL.createObjectURL(local.blob);
  if (photo.storage_path && navigator.onLine) {
    const { data } = await supabase.storage
      .from("site-surveys")
      .createSignedUrl(photo.storage_path, 3600);
    return data?.signedUrl ?? null;
  }
  return null;
}

/** Fotoğraf verisi (teklif belgesine gömmek için küçük boy). */
export async function photoDataUrl(photo: SurveyPhotoMeta, maxSide = 900) {
  let blob: Blob | null =
    (await idbGet<LocalPhoto>("photos", photo.id))?.blob ?? null;
  if (!blob && photo.storage_path) {
    const { data } = await supabase.storage
      .from("site-surveys")
      .download(photo.storage_path);
    blob = data ?? null;
  }
  if (!blob) return null;
  const small = await compressImage(blob, maxSide, 0.72);
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(small);
  });
}

// ---------------------------------------------------------------- sunucu

/** Bir keşfi sunucuya gönderir (başlık, kalemler, fotoğraflar). */
export async function pushSurvey(survey: Survey): Promise<Survey> {
  const { data: header, error } = await supabase
    .from("site_surveys")
    .upsert({
      id: survey.id,
      title: survey.title.trim() || "Adsız keşif",
      work_type: survey.work_type,
      customer_id: survey.customer_id,
      customer_name: survey.customer_name?.trim() || null,
      contact_phone: survey.contact_phone?.trim() || null,
      location_text: survey.location_text?.trim() || null,
      latitude: survey.latitude,
      longitude: survey.longitude,
      location_accuracy_m: survey.location_accuracy_m,
      notes: survey.notes || null,
      status: survey.status,
      offer_id: survey.offer_id,
      surveyed_at: survey.surveyed_at,
    })
    .select("survey_no")
    .single();
  if (error) throw error;

  // Kalemler: sunucudaki listeyi cihazdakiyle aynı yap.
  const del = await supabase
    .from("site_survey_items")
    .delete()
    .eq("survey_id", survey.id);
  if (del.error) throw del.error;
  if (survey.items.length) {
    const ins = await supabase.from("site_survey_items").insert(
      survey.items.map((item, i) => ({
        id: item.id,
        survey_id: survey.id,
        position: i + 1,
        description: item.description.trim().slice(0, 300) || "Kalem",
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
        unit: item.unit || "adet",
        catalog_item_id: item.catalog_item_id,
        note: item.note?.trim() || null,
      })),
    );
    if (ins.error) throw ins.error;
  }

  // Fotoğraflar: gönderilmemişleri yükle.
  const photos: SurveyPhotoMeta[] = [];
  for (const photo of survey.photos) {
    let path = photo.storage_path;
    const local = await idbGet<LocalPhoto>("photos", photo.id);
    if (!path && local?.blob) {
      path = `${survey.id}/${photo.id}.jpg`;
      const up = await supabase.storage
        .from("site-surveys")
        .upload(path, local.blob, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw up.error;
    }
    if (path) {
      const row = await supabase.from("site_survey_photos").upsert({
        id: photo.id,
        survey_id: survey.id,
        storage_path: path,
        caption: photo.caption,
        taken_at: photo.taken_at,
        include_in_offer: photo.include_in_offer,
      });
      if (row.error) throw row.error;
      if (local) await idbSet("photos", photo.id, { ...local, synced: true });
    }
    photos.push({ ...photo, storage_path: path });
  }

  const audios: SurveyAudioMeta[] = [];
  for (const audio of survey.audios ?? []) {
    let path = audio.storage_path;
    const local = await idbGet<LocalPhoto>("photos", audio.id);
    if (!path && local?.blob) {
      const mime = (audio.mime || "audio/webm").split(";")[0];
      path = `${survey.id}/${audio.id}.${audioExt(mime)}`;
      const up = await supabase.storage
        .from("site-surveys")
        .upload(path, local.blob, { contentType: mime, upsert: true });
      if (up.error) throw up.error;
    }
    if (path) {
      const row = await supabase.from("site_survey_photos").upsert({
        id: audio.id,
        survey_id: survey.id,
        storage_path: path,
        kind: "audio",
        duration_s: audio.duration_s,
        transcript: audio.transcript,
        taken_at: audio.taken_at,
        include_in_offer: false,
      });
      if (row.error) throw row.error;
    }
    audios.push({ ...audio, storage_path: path });
  }

  const synced: Survey = {
    ...survey,
    survey_no: header?.survey_no ?? survey.survey_no,
    photos,
    audios,
    synced_at: nowIso(),
  };
  // Gönderim sırasında kullanıcı yeni değişiklik yaptıysa onu ezme.
  const latest = await getLocal(survey.id);
  if (latest && latest.local_updated_at > survey.local_updated_at) {
    await idbSet("surveys", survey.id, {
      ...latest,
      survey_no: synced.survey_no,
      photos: latest.photos.map((p) => photos.find((x) => x.id === p.id) ?? p),
      audios: (latest.audios ?? []).map(
        (a) => audios.find((x) => x.id === a.id) ?? a,
      ),
    });
    return latest;
  }
  synced.local_updated_at = synced.synced_at as string;
  await idbSet("surveys", survey.id, synced);
  return synced;
}

let syncing = false;
/** Gönderilmemiş tüm keşifleri gönderir. Hata olanlar sonra tekrar denenir. */
export async function syncAll(): Promise<{ sent: number; failed: number }> {
  if (syncing || !navigator.onLine) return { sent: 0, failed: 0 };
  syncing = true;
  let sent = 0;
  let failed = 0;
  try {
    for (const survey of await listLocal()) {
      if (!isDirty(survey)) continue;
      try {
        await pushSurvey(survey);
        sent += 1;
      } catch (error) {
        console.error("Keşif gönderilemedi", survey.id, error);
        failed += 1;
      }
    }
  } finally {
    syncing = false;
  }
  return { sent, failed };
}

/** Sunucudaki keşifleri cihaza indirir (cihazda daha yeni hali varsa korur). */
export async function pullSurveys(limit = 60) {
  const { data, error } = await supabase
    .from("site_surveys")
    .select(
      "id, survey_no, title, work_type, customer_id, customer_name, contact_phone, location_text, latitude, longitude, location_accuracy_m, notes, status, offer_id, surveyed_at, updated_at, site_survey_items(id, position, description, quantity, unit, catalog_item_id, note), site_survey_photos(id, storage_path, caption, taken_at, include_in_offer, kind, duration_s, transcript)",
    )
    .order("surveyed_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  for (const row of data ?? []) {
    const local = await getLocal(row.id);
    if (local && isDirty(local)) continue;
    const survey: Survey = {
      id: row.id,
      survey_no: row.survey_no,
      title: row.title,
      work_type: row.work_type as WorkType,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      contact_phone: row.contact_phone,
      location_text: row.location_text,
      latitude: row.latitude,
      longitude: row.longitude,
      location_accuracy_m: row.location_accuracy_m,
      notes: row.notes ?? "",
      status: row.status as Survey["status"],
      offer_id: row.offer_id,
      surveyed_at: row.surveyed_at,
      items: [...(row.site_survey_items ?? [])]
        .sort((a, b) => a.position - b.position)
        .map((i) => ({
          id: i.id,
          description: i.description,
          quantity: Number(i.quantity),
          unit: i.unit,
          catalog_item_id: i.catalog_item_id,
          note: i.note,
        })),
      audios: [...(row.site_survey_photos ?? [])]
        .filter((p) => p.kind === "audio")
        .sort((a, b) => a.taken_at.localeCompare(b.taken_at))
        .map((p) => ({
          id: p.id,
          taken_at: p.taken_at,
          duration_s: p.duration_s ?? 0,
          mime: p.storage_path.endsWith(".m4a") ? "audio/mp4" : "audio/webm",
          storage_path: p.storage_path,
          transcript: p.transcript,
        })),
      photos: [...(row.site_survey_photos ?? [])]
        .filter((p) => p.kind !== "audio")
        .sort((a, b) => a.taken_at.localeCompare(b.taken_at))
        .map((p) => ({
          id: p.id,
          caption: p.caption,
          taken_at: p.taken_at,
          include_in_offer: p.include_in_offer,
          storage_path: p.storage_path,
        })),
      local_updated_at: row.updated_at,
      synced_at: row.updated_at,
    };
    await idbSet("surveys", row.id, survey);
  }
  // Sunucuda silinmiş keşifler cihazda da kalkar. Yalnız gönderilmiş
  // (değişikliği olmayan) kopyalar silinir; liste tam geldiyse yapılır.
  if ((data ?? []).length < limit) {
    const onServer = new Set((data ?? []).map((row) => row.id));
    for (const local of await listLocal()) {
      if (!onServer.has(local.id) && !isDirty(local)) await deleteLocal(local);
    }
  }
}

// ---------------------------------------------------------------- önbellek

export type CachedCatalogItem = {
  id: string;
  code: string;
  name: string;
  brand: string | null;
  model: string | null;
  unit: string;
  module: string;
};
export type CachedCustomer = { id: string; name: string };

/** Katalog ve müşteri listesi: internet varken yenilenir, yokken cihazdan. */
export async function refreshReferenceCache() {
  if (!navigator.onLine) return;
  const [catalog, customers] = await Promise.all([
    supabase
      .from("offer_catalog_items")
      .select("id, code, name, brand, model, unit, module")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.rpc("list_project_customers"),
  ]);
  if (!catalog.error) await idbSet("cache", "catalog", catalog.data ?? []);
  if (!customers.error) {
    const list = ((customers.data ?? []) as { id: string; name: string }[]).map(
      (c) => ({
        id: c.id,
        name: c.name,
      }),
    );
    await idbSet("cache", "customers", list);
  }
}

export async function cachedCatalog() {
  return (await idbGet<CachedCatalogItem[]>("cache", "catalog")) ?? [];
}
export async function cachedCustomers() {
  return (await idbGet<CachedCustomer[]>("cache", "customers")) ?? [];
}
