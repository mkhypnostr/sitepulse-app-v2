// Uygulama içi asistan: yazarak ya da sesle (Türkçe) istek verilir; asistan
// kayıtları arar, görev / iş emri / proje / satış fırsatı açar, GES teklifini
// hazırlar. Kayıt açan her işlem için önce onay kartı gösterilir.
// Sunucu tarafı: supabase/functions/nes-assistant.
// Sohbetler assistant_conversations tablosunda kalıcı saklanır (yalnız
// sahibi görür); "Geçmiş" listesinden eski sohbetler açılır, silinmez.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  FileDown,
  History,
  ImagePlus,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { compressImage } from "@/lib/image-compress";
import { companyFromProfile } from "@/lib/company";
import { htmlToPdf } from "@/lib/html-to-pdf";
import { shareFile } from "@/lib/send-channels";
import {
  billTotals,
  customerBillHtml,
  internalRecordHtml,
  tl,
  type BillHeader,
  type BillLine,
} from "@/lib/progress-bill";

const PHOTO_BUCKET = "assistant-uploads";
/** Fotoğraf mesaja "[[foto:YOL]]" işaretiyle girer; sunucu modele
 * gönderirken görsele çevirir (geçmiş küçük kalır). */
const photoMarker = (path: string) => `[[foto:${path}]]`;

type ApiMessage = { role: "user" | "assistant"; content: unknown };
type AssistantLink = { label: string; href: string };
type Pending = { name: string; summary: string };
/** Asistanın hazırladığı belge; PDF tarayıcıda üretilir. */
type AssistantDocument = BillHeader & {
  kind: "hakedis";
  photo_path: string | null;
  lines: BillLine[];
};
type Entry = {
  role: "user" | "assistant" | "error";
  text: string;
  /** Mesajın zamanı (ISO). */
  at?: string;
  links?: AssistantLink[];
  pending?: Pending[];
  resolved?: "approved" | "declined";
  /** Kullanıcının eklediği fotoğrafların depo yolları. */
  photos?: string[];
  documents?: AssistantDocument[];
  /** Bu cevabı üreten istek; sunucu sohbete yazdıysa tekrar eklenmez. */
  request_id?: string;
};
type AssistantResponse = {
  /** Yedekten okunan cevapta HTTP durumu. */
  status?: number;
  messages?: ApiMessage[];
  reply?: string;
  links?: AssistantLink[];
  pending?: Pending[];
  documents?: AssistantDocument[];
  error?: string;
  code?: string;
};

const CURRENT_KEY = "nes-assistant-current";
/** Modele gönderilen geçmişin üst sınırı (sunucu 80'i reddeder). Ekrandaki
 * geçmiş tam kalır; yalnız modele giden kısım kırpılır. */
const MAX_API_MESSAGES = 50;

type ConversationState = {
  id: string | null;
  messages: ApiMessage[];
  entries: Entry[];
};
type ConversationSummary = { id: string; title: string; updated_at: string };

/** Uzun sohbette modele yalnız son kısmı gönder. Kesim, düz metinli bir
 * kullanıcı mesajından başlar (araç çağrısı/yanıtı yarıda kalmaz). */
function trimForApi(messages: ApiMessage[]) {
  if (messages.length <= MAX_API_MESSAGES) return messages;
  for (let i = messages.length - MAX_API_MESSAGES; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") {
      return messages.slice(i);
    }
  }
  return messages.slice(-1);
}

const nowIso = () => new Date().toISOString();
const timeTr = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
const dayTr = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return `Bugün ${timeTr(iso)}`;
  if (d.toDateString() === yesterday.toDateString())
    return `Dün ${timeTr(iso)}`;
  return d.toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
};
const emptyState = (): ConversationState => ({
  id: null,
  messages: [],
  entries: [],
});
const EXAMPLES = [
  "Bugün geciken işler neler?",
  "Mehmetcan'a yarın için pano kontrol görevi aç",
  "Gökova'daki fabrikanın arıza çağrısını iş emri olarak aç",
  "Datça'daki otel için satış fırsatı ekle, haftaya pazartesi ara",
];

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function speechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function readCurrentId() {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}
function writeCurrentId(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Saklama alanı kapalıysa en son sohbet açılır.
  }
}

type WakeLockLike = { release: () => Promise<void> };

/** Ekranı uyanık tut (destekleyen tarayıcılarda; iPhone Safari 16.4+). */
async function keepScreenAwake(): Promise<WakeLockLike | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockLike> };
    };
    return (await nav.wakeLock?.request("screen")) ?? null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const INFLIGHT_KEY = "nes-assistant-inflight";
type Inflight = { conversationId: string; requestId: string; at: number };
/** Sunucuya gönderilmiş ama cevabı henüz ekrana gelmemiş istek. */
function readInflight(): Inflight | null {
  try {
    const raw = localStorage.getItem(INFLIGHT_KEY);
    return raw ? (JSON.parse(raw) as Inflight) : null;
  } catch {
    return null;
  }
}
function writeInflight(value: Inflight | null) {
  try {
    if (value) localStorage.setItem(INFLIGHT_KEY, JSON.stringify(value));
    else localStorage.removeItem(INFLIGHT_KEY);
  } catch {
    // Saklama alanı kapalıysa yalnız açık sayfa bekler.
  }
}
/** Sunucu cevabı sohbete yazana kadar bekle (en çok 5 dk). */
const REPLY_WAIT_MS = 300_000;
async function waitForReply(
  conversationId: string,
  requestId: string,
  untilMs: number,
) {
  for (;;) {
    const { data } = await supabase
      .from("assistant_conversations")
      .select("id, entries, messages")
      .eq("id", conversationId)
      .maybeSingle();
    const entries = (data?.entries ?? []) as Entry[];
    if (data && entries.some((e) => e.request_id === requestId)) {
      return {
        id: data.id,
        entries,
        messages: (data.messages ?? []) as ApiMessage[],
      } satisfies ConversationState;
    }
    if (Date.now() > untilMs) return null;
    await sleep(4000);
  }
}

/** Sohbeti hemen kaydet (istek gönderilmeden önce; sunucu cevabı buna
 * ekler). */
async function persistConversation(next: ConversationState) {
  if (!next.id) return;
  const firstUser = next.entries.find((e) => e.role === "user");
  await supabase.from("assistant_conversations").upsert({
    id: next.id,
    title: (firstUser?.text ?? "Sohbet").slice(0, 120),
    entries: next.entries as unknown as never,
    messages: next.messages as unknown as never,
  });
  writeCurrentId(next.id);
}

async function errorText(error: unknown) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as AssistantResponse;
      if (body.code === "no_key") {
        return "Asistan henüz açılmadı: Anthropic API anahtarı tanımlanmalı. Yönetici, anahtarı Supabase → Edge Functions → Secrets bölümüne ANTHROPIC_API_KEY adıyla ekleyince asistan çalışır.";
      }
      if (body.error) return body.error;
    } catch {
      // Gövde okunamadı.
    }
  }
  return "Asistana ulaşılamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.";
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ConversationState>(emptyState);
  const [loaded, setLoaded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConversationSummary[] | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [photos, setPhotos] = useState<{ path: string; preview: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const speechSupported = Boolean(speechRecognitionCtor());
  const router = useRouter();

  // Panel ilk açıldığında son sohbet (ya da en son açılan) yüklenir.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    void (async () => {
      const currentId = readCurrentId();
      let query = supabase
        .from("assistant_conversations")
        .select("id, entries, messages")
        .order("updated_at", { ascending: false })
        .limit(1);
      if (currentId) query = query.eq("id", currentId);
      const { data } = await query;
      const row = data?.[0];
      if (row) {
        const entries = (row.entries ?? []) as Entry[];
        setState({
          id: row.id,
          entries,
          messages: (row.messages ?? []) as ApiMessage[],
        });
        // Uygulama kapanmadan önce gönderilmiş ve cevabı henüz gelmemiş
        // bir istek varsa, sunucu sohbete yazana kadar bekle.
        const inflight = readInflight();
        if (
          inflight &&
          inflight.conversationId === row.id &&
          !entries.some((e) => e.request_id === inflight.requestId) &&
          Date.now() - inflight.at < REPLY_WAIT_MS
        ) {
          setBusy(true);
          setRecovering(true);
          const reply = await waitForReply(
            row.id,
            inflight.requestId,
            inflight.at + REPLY_WAIT_MS,
          );
          if (reply) setState(reply);
          writeInflight(null);
          setRecovering(false);
          setBusy(false);
        } else if (inflight) {
          writeInflight(null);
        }
      }
    })();
  }, [open, loaded]);

  // Her değişiklikten sonra sohbeti kaydet (kısa gecikmeyle, tek istek).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    if (!state.id || state.entries.length === 0) return;
    const timer = setTimeout(() => {
      const firstUser = state.entries.find((e) => e.role === "user");
      // Sorgu oluşturucusu ancak then() ile çalışır; void ile bırakılırsa
      // istek hiç gönderilmez.
      void supabase
        .from("assistant_conversations")
        .upsert({
          id: state.id as string,
          title: (firstUser?.text ?? "Sohbet").slice(0, 120),
          entries: state.entries as unknown as never,
          messages: state.messages as unknown as never,
        })
        .then(({ error }) => {
          if (error) console.error("Sohbet kaydedilemedi", error.message);
        });
      writeCurrentId(state.id);
    }, 500);
    return () => clearTimeout(timer);
  }, [state]);

  async function openHistory() {
    setShowHistory(true);
    const { data } = await supabase
      .from("assistant_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(100);
    setHistory((data ?? []) as ConversationSummary[]);
  }

  async function deleteConversation(id: string, title: string) {
    if (!window.confirm(`"${title}" sohbeti silinsin mi? Geri alınamaz.`))
      return;
    const { error } = await supabase
      .from("assistant_conversations")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Sohbet silinemedi.");
      return;
    }
    setHistory((list) => (list ?? []).filter((c) => c.id !== id));
    // Açık sohbet silindiyse temiz sohbete geç (geçmiş listesi açık kalır).
    if (state.id === id) {
      recognitionRef.current?.stop();
      setState(emptyState());
      writeCurrentId(null);
    }
    toast.success("Sohbet silindi.");
  }

  async function openConversation(id: string) {
    const { data } = await supabase
      .from("assistant_conversations")
      .select("id, entries, messages")
      .eq("id", id)
      .maybeSingle();
    if (data) {
      recognitionRef.current?.stop();
      setState({
        id: data.id,
        entries: (data.entries ?? []) as Entry[],
        messages: (data.messages ?? []) as ApiMessage[],
      });
      writeCurrentId(data.id);
    }
    setShowHistory(false);
  }

  // Ctrl+J (Mac'te Cmd+J) asistanı açar/kapatır.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const call = useCallback(
    async (body: {
      messages: ApiMessage[];
      confirm?: { approved: boolean };
      conversationId: string;
    }) => {
      setBusy(true);
      // Cevap beklerken ekran kapanmasın; kapansa da iş sunucuda sürer ve
      // cevap sohbete yazılır.
      const wakeLock = await keepScreenAwake();
      const requestId = crypto.randomUUID();
      const sent = trimForApi(body.messages);
      writeInflight({
        conversationId: body.conversationId,
        requestId,
        at: Date.now(),
      });
      const apply = (response: AssistantResponse) => {
        const added = response.messages
          ? response.messages.slice(sent.length)
          : [];
        setState((current) =>
          current.id !== body.conversationId ||
          current.entries.some((e) => e.request_id === requestId)
            ? current
            : {
                ...current,
                messages: [...body.messages, ...added],
                entries: [
                  ...current.entries,
                  {
                    role: "assistant",
                    at: nowIso(),
                    request_id: requestId,
                    text:
                      response.reply ||
                      (response.pending?.length
                        ? "Şu işlemi yapmamı onaylıyor musunuz?"
                        : ""),
                    links: response.links,
                    pending: response.pending,
                    documents: response.documents?.length
                      ? response.documents
                      : undefined,
                  },
                ],
              },
        );
      };
      const fail = (text: string) =>
        setState((current) => ({
          ...current,
          entries: [
            ...current.entries,
            { role: "error", text, at: nowIso(), request_id: requestId },
          ],
        }));
      try {
        const { data, error } =
          await supabase.functions.invoke<AssistantResponse>("nes-assistant", {
            body: {
              messages: sent,
              confirm: body.confirm,
              request_id: requestId,
              conversation_id: body.conversationId,
              history_length: body.messages.length,
            },
          });
        if (error) throw error;
        apply(data ?? {});
      } catch (error) {
        if (error instanceof FunctionsHttpError) {
          fail(await errorText(error));
        } else {
          // Bağlantı koptu (çoğunlukla ekran kapandı): sunucu işi bitirip
          // cevabı sohbete yazar; oradan alınır.
          setRecovering(true);
          const row = await waitForReply(
            body.conversationId,
            requestId,
            Date.now() + REPLY_WAIT_MS,
          );
          setRecovering(false);
          if (row) {
            setState((current) =>
              current.id === body.conversationId ? row : current,
            );
          } else {
            fail(
              "Cevap alınamadı (internet gitmiş olabilir). Aynı isteği tekrar gönderin.",
            );
          }
        }
      } finally {
        writeInflight(null);
        void wakeLock?.release().catch(() => undefined);
        setBusy(false);
      }
    },
    [],
  );

  async function addPhoto(file: File) {
    setUploading(true);
    try {
      // El yazısı okunabilsin diye büyük tutulur (~1,5 MB'a kadar).
      const blob = await compressImage(file, 2400, 1_500_000);
      const { data: auth } = await supabase.auth.getUser();
      const path = `${auth.user?.id ?? "anon"}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage
        .from(PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw error;
      setPhotos((list) => [
        ...list,
        { path, preview: URL.createObjectURL(blob) },
      ]);
    } catch {
      toast.error("Fotoğraf yüklenemedi. İnternet bağlantısını kontrol edin.");
    } finally {
      setUploading(false);
    }
  }

  function send(text: string) {
    const photoPaths = photos.map((p) => p.path);
    const trimmed =
      text.trim() || (photoPaths.length ? "Bu fotoğrafı inceler misin?" : "");
    if (!trimmed || busy || uploading) return;
    recognitionRef.current?.stop();
    setInput("");
    setPhotos([]);
    const messages: ApiMessage[] = [
      ...state.messages,
      {
        role: "user",
        content: photoPaths.length
          ? [
              ...photoPaths.map((p) => ({
                type: "text",
                text: photoMarker(p),
              })),
              { type: "text", text: trimmed },
            ]
          : trimmed,
      },
    ];
    const next: ConversationState = {
      id: state.id ?? crypto.randomUUID(),
      messages,
      entries: [
        ...state.entries.map((entry) =>
          entry.pending && !entry.resolved
            ? { ...entry, resolved: "declined" as const }
            : entry,
        ),
        {
          role: "user",
          text: trimmed,
          at: nowIso(),
          photos: photoPaths.length ? photoPaths : undefined,
        },
      ],
    };
    setState(next);
    setBusy(true);
    void persistConversation(next)
      .catch(() => undefined)
      .then(() => call({ messages, conversationId: next.id as string }));
  }

  function resolve(index: number, approved: boolean) {
    if (!state.id) return;
    const next: ConversationState = {
      ...state,
      entries: state.entries.map((entry, i) =>
        i === index
          ? { ...entry, resolved: approved ? "approved" : "declined" }
          : entry,
      ),
    };
    setState(next);
    setBusy(true);
    void persistConversation(next)
      .catch(() => undefined)
      .then(() =>
        call({
          messages: state.messages,
          confirm: { approved },
          conversationId: next.id as string,
        }),
      );
  }

  function toggleListening() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = "tr-TR";
    recognition.interimResults = true;
    recognition.continuous = false;
    const base = input ? `${input.trim()} ` : "";
    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setInput(base + text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  /** Yeni sohbet: eski sohbet silinmez, Geçmiş'te kalır. */
  function reset() {
    recognitionRef.current?.stop();
    setState(emptyState());
    writeCurrentId(null);
    setShowHistory(false);
  }

  let lastPendingIndex = -1;
  state.entries.forEach((entry, i) => {
    if (entry.pending?.length && !entry.resolved) lastPendingIndex = i;
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition hover:scale-[1.03] lg:bottom-6 lg:right-6"
        aria-label="Asistanı aç (Ctrl+J)"
        title="Asistan (Ctrl+J)"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">Asistan</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Asistan
              </SheetTitle>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    showHistory ? setShowHistory(false) : void openHistory()
                  }
                  disabled={busy}
                >
                  {showHistory ? (
                    <ChevronLeft className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <History className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {showHistory ? "Sohbete dön" : "Geçmiş"}
                </Button>
                {state.entries.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={reset}
                    disabled={busy}
                  >
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Yeni
                  </Button>
                ) : null}
              </div>
            </div>
            <SheetDescription>
              Yazın, konuşun ya da fotoğraf ekleyin. Kayıt açmadan önce
              onayınızı isterim.
            </SheetDescription>
          </SheetHeader>

          {showHistory ? (
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {history === null ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Yükleniyor...
                </p>
              ) : history.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  Henüz kayıtlı sohbet yok.
                </p>
              ) : (
                history.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-start gap-1 rounded-xl hover:bg-muted ${c.id === state.id ? "bg-muted" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => void openConversation(c.id)}
                      className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left"
                    >
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {c.title}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {dayTr(c.updated_at)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label="Sohbeti sil"
                      title="Sohbeti sil"
                      className="mr-1 mt-1.5 shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => void deleteConversation(c.id, c.title)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="min-w-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-4">
              {state.entries.length === 0 ? (
                <div className="grid gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    Örnekler
                  </p>
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => send(example)}
                      className="rounded-xl border border-border bg-muted/40 px-3 py-2 text-left text-sm hover:border-primary/50"
                    >
                      {example}
                    </button>
                  ))}
                  <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                    Hakediş için: aşağıdaki resim düğmesiyle taşeronun
                    listesinin fotoğrafını ekleyin ve "%25 kârla Yakup Avşar'a
                    hakediş hazırla" gibi yazın.
                  </p>
                </div>
              ) : null}
              {state.entries.map((entry, index) => (
                <div
                  key={index}
                  className={
                    entry.role === "user"
                      ? "ml-8 min-w-0 break-words rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground [overflow-wrap:anywhere]"
                      : entry.role === "error"
                        ? "mr-8 min-w-0 break-words rounded-2xl rounded-bl-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]"
                        : "mr-8 min-w-0 break-words rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm [overflow-wrap:anywhere]"
                  }
                >
                  {entry.photos?.length ? (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {entry.photos.map((p) => (
                        <PhotoThumb key={p} path={p} />
                      ))}
                    </div>
                  ) : null}
                  {entry.text ? (
                    entry.role === "assistant" ? (
                      <AssistantText text={entry.text} />
                    ) : (
                      <p className="whitespace-pre-wrap">{entry.text}</p>
                    )
                  ) : null}
                  {entry.pending?.length ? (
                    <div className="mt-2 grid gap-2 rounded-xl border border-primary/30 bg-background p-2.5">
                      {entry.pending.map((item, i) => (
                        <p key={i} className="text-sm font-semibold">
                          {item.summary}
                        </p>
                      ))}
                      {entry.resolved ? (
                        <p
                          className={`text-xs font-bold ${entry.resolved === "approved" ? "text-emerald-600" : "text-muted-foreground"}`}
                        >
                          {entry.resolved === "approved"
                            ? "Onaylandı"
                            : "Yapılmadı"}
                        </p>
                      ) : index === lastPendingIndex ? (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="font-bold"
                            disabled={busy}
                            onClick={() => resolve(index, true)}
                          >
                            <Check className="mr-1.5 h-3.5 w-3.5" /> Onayla
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => resolve(index, false)}
                          >
                            <X className="mr-1.5 h-3.5 w-3.5" /> Vazgeç
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {entry.at ? (
                    <p
                      className={`mt-1 text-right text-[10px] ${entry.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                    >
                      {timeTr(entry.at)}
                    </p>
                  ) : null}
                  {entry.documents?.map((doc, i) => (
                    <DocumentCard key={i} doc={doc} />
                  ))}
                  {entry.links?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {entry.links.map((link, i) =>
                        link.href.startsWith("/") ? (
                          <Button
                            key={i}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-auto min-h-8 max-w-full whitespace-normal break-words bg-background py-1.5 text-left"
                            onClick={() => {
                              setOpen(false);
                              router.history.push(link.href);
                            }}
                          >
                            {link.label}
                          </Button>
                        ) : (
                          <Button
                            key={i}
                            asChild
                            size="sm"
                            variant="outline"
                            className="h-auto min-h-8 max-w-full whitespace-normal break-words bg-background py-1.5 text-left"
                          >
                            <a
                              href={link.href}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {link.label}
                              <ExternalLink className="ml-1.5 h-3 w-3" />
                            </a>
                          </Button>
                        ),
                      )}
                    </div>
                  ) : null}
                </div>
              ))}
              {busy ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle className="h-4 w-4 animate-spin" />{" "}
                  {recovering
                    ? "Cevap hazırlanıyor, gelince buraya eklenecek..."
                    : "Çalışıyorum... Ekranı kapatsanız da devam ederim."}
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          )}

          {photos.length || uploading ? (
            <div className="flex flex-wrap items-center gap-2 border-t px-3 pt-3">
              {photos.map((p) => (
                <div key={p.path} className="relative">
                  <img
                    src={p.preview}
                    alt="Eklenen fotoğraf"
                    className="h-14 w-14 rounded-lg border object-cover"
                  />
                  <button
                    type="button"
                    aria-label="Fotoğrafı çıkar"
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-foreground p-0.5 text-background"
                    onClick={() =>
                      setPhotos((list) => list.filter((x) => x.path !== p.path))
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {uploading ? (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />{" "}
                  Yükleniyor...
                </span>
              ) : null}
            </div>
          ) : null}
          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(input);
            }}
          >
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(input);
                }
              }}
              placeholder={
                listening ? "Dinliyorum..." : "Ne yapmamı istersiniz?"
              }
              rows={2}
              className="min-h-[44px] flex-1 resize-none"
            />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="relative h-11 w-11 shrink-0 overflow-hidden"
              disabled={uploading || busy}
              aria-label="Fotoğraf ekle"
              title="Fotoğraf ekle (taşeron listesi, fatura, saha)"
              asChild
            >
              <label>
                <ImagePlus className="h-4 w-4" />
                <input
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void addPhoto(file);
                  }}
                />
              </label>
            </Button>
            {speechSupported ? (
              <Button
                type="button"
                size="icon"
                variant={listening ? "destructive" : "outline"}
                className="h-11 w-11 shrink-0"
                onClick={toggleListening}
                aria-label={listening ? "Dinlemeyi durdur" : "Sesle yaz"}
                title={listening ? "Dinlemeyi durdur" : "Sesle yaz"}
              >
                {listening ? (
                  <MicOff className="h-4 w-4" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
              </Button>
            ) : null}
            <Button
              type="submit"
              size="icon"
              className="h-11 w-11 shrink-0"
              disabled={busy || uploading || (!input.trim() && !photos.length)}
              aria-label="Gönder"
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const safeName = (v: string) =>
  v
    .replace(/[^wçğıöşüÇĞİÖŞÜ]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/** Hakediş belgesi: özet + iki PDF (müşteri hakedişi, taşeron iç kaydı). */
function DocumentCard({ doc }: { doc: AssistantDocument }) {
  const [busy, setBusy] = useState<string | null>(null);
  const t = billTotals(doc.lines, doc.margin_pct, doc.vat_rate);
  const diff =
    doc.written_total != null
      ? Math.round((t.cost - doc.written_total) * 100) / 100
      : null;
  const flagged = doc.lines.filter((l) => l.note).length;

  async function make(kind: "customer" | "internal") {
    const [profile, bank] = await Promise.all([
      supabase.from("company_profile").select("*").eq("id", 1).maybeSingle(),
      supabase
        .from("cash_accounts")
        .select("bank_name, iban")
        .eq("show_on_invoice", true)
        .eq("is_active", true)
        .order("sort_order")
        .limit(1)
        .maybeSingle(),
    ]);
    const company = companyFromProfile(profile.data ?? null, bank.data ?? null);
    const origin = window.location.origin;
    const date = doc.bill_date.replace(/-/g, "");
    const base = `${date}_${safeName(doc.customer_name || doc.title)}`;
    if (kind === "customer") {
      return htmlToPdf(
        customerBillHtml(doc, doc.lines, company, origin),
        `${base}_Hakedis.pdf`,
      );
    }
    let photo: string | null = null;
    if (doc.photo_path) {
      const { data } = await supabase.storage
        .from(PHOTO_BUCKET)
        .createSignedUrl(doc.photo_path, 600);
      if (data?.signedUrl) {
        const res = await fetch(data.signedUrl);
        if (res.ok) photo = await blobToDataUrl(await res.blob());
      }
    }
    return htmlToPdf(
      internalRecordHtml(doc, doc.lines, company, origin, photo),
      `${date}_${safeName(doc.subcontractor_name)}_TaseronKaydi.pdf`,
    );
  }

  async function run(kind: "customer" | "internal", share: boolean) {
    setBusy(`${kind}-${share}`);
    try {
      const file = await make(kind);
      if (share) {
        const ok = await shareFile(file, doc.title).catch(() => false);
        if (!ok) downloadFile(file);
      } else {
        downloadFile(file);
      }
    } catch {
      toast.error("PDF hazırlanamadı. Tekrar deneyin.");
    } finally {
      setBusy(null);
    }
  }

  const icon = (k: string, Icon: typeof FileDown) =>
    busy === k ? (
      <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
    ) : (
      <Icon className="mr-1.5 h-3.5 w-3.5" />
    );

  return (
    <div className="mt-2 grid gap-2 rounded-xl border border-primary/30 bg-background p-2.5 text-[13px]">
      <div>
        <p className="font-bold">{doc.title}</p>
        <p className="text-xs text-muted-foreground">
          {doc.lines.length} kalem · taşeron {tl(t.cost)} · müşteriye{" "}
          {tl(t.sell)} + KDV = <b className="text-foreground">{tl(t.grand)}</b>
        </p>
        {diff ? (
          <p className="text-xs font-semibold text-destructive">
            Listedeki toplamdan {tl(diff)} fark var
          </p>
        ) : doc.written_total != null ? (
          <p className="text-xs font-semibold text-emerald-600">
            Listedeki toplamla tutuyor
          </p>
        ) : null}
        {flagged ? (
          <p className="text-xs text-amber-600">
            {flagged} satır kontrol edilmeli (taşeron kaydında sarı)
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={!!busy}
          onClick={() => void run("customer", false)}
        >
          {icon("customer-false", FileDown)} Müşteri hakedişi
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => void run("customer", true)}
        >
          {icon("customer-true", Share2)} Paylaş
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!!busy}
          onClick={() => void run("internal", false)}
        >
          {icon("internal-false", FileDown)} Taşeron kaydı
        </Button>
      </div>
    </div>
  );
}

/** Sohbetteki fotoğrafın küçük önizlemesi (özel depodan imzalı adresle). */
function PhotoThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void supabase.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (alive) setUrl(data?.signedUrl ?? null);
      });
    return () => {
      alive = false;
    };
  }, [path]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img
        src={url}
        alt="Eklenen fotoğraf"
        className="h-20 w-20 rounded-lg border border-white/30 object-cover"
      />
    </a>
  ) : (
    <div className="h-20 w-20 rounded-lg bg-white/20" />
  );
}

/** Asistan yanıtındaki basit biçimleri (kalın, madde, tablo) düz ve okunur
 * hale getirir. HTML üretmez; metin React öğeleriyle basılır. */
function AssistantText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const out: { kind: "p" | "li" | "row"; text: string }[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\|?\s*:?-{2,}/.test(line)) continue; // tablo ayırıcı satırı
    if (line.startsWith("|")) {
      const cells = line
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      out.push({ kind: "row", text: cells.join(" · ") });
    } else if (/^[-*•]\s+/.test(line)) {
      out.push({ kind: "li", text: line.replace(/^[-*•]\s+/, "") });
    } else {
      out.push({ kind: "p", text: line.replace(/^#+\s*/, "") });
    }
  }
  const bold = (t: string) =>
    t
      .split(/(\*\*[^*]+\*\*)/g)
      .map((part, i) =>
        /^\*\*[^*]+\*\*$/.test(part) ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className="grid gap-1">
      {out.map((item, i) =>
        item.text === "" ? (
          <div key={i} className="h-1" />
        ) : item.kind === "li" ? (
          <p key={i} className="pl-3 -indent-3">
            • {bold(item.text)}
          </p>
        ) : item.kind === "row" ? (
          <p
            key={i}
            className="rounded-md bg-background/60 px-2 py-1 text-[13px]"
          >
            {bold(item.text)}
          </p>
        ) : (
          <p key={i}>{bold(item.text)}</p>
        ),
      )}
    </div>
  );
}
