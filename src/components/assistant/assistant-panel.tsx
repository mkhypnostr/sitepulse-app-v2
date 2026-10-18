// Uygulama içi asistan: yazarak ya da sesle (Türkçe) istek verilir; asistan
// kayıtları arar, görev / iş emri / proje / satış fırsatı açar, GES teklifini
// hazırlar. Kayıt açan her işlem için önce onay kartı gösterilir.
// Sunucu tarafı: supabase/functions/nes-assistant.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  Check,
  ExternalLink,
  LoaderCircle,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
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

type ApiMessage = { role: "user" | "assistant"; content: unknown };
type AssistantLink = { label: string; href: string };
type Pending = { name: string; summary: string };
type Entry = {
  role: "user" | "assistant" | "error";
  text: string;
  links?: AssistantLink[];
  pending?: Pending[];
  resolved?: "approved" | "declined";
};
type AssistantResponse = {
  messages?: ApiMessage[];
  reply?: string;
  links?: AssistantLink[];
  pending?: Pending[];
  error?: string;
  code?: string;
};

const STORAGE_KEY = "nes-assistant-v1";
const EXAMPLES = [
  "Bugün geciken işler neler?",
  "Mehmetcan'a yarın için pano kontrol görevi aç",
  "Akyaka'daki villa için 10 kWp on-grid GES teklifi hazırla",
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
  (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

function loadState(): { messages: ApiMessage[]; entries: Entry[] } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Saklama alanı kapalıysa boş başlar.
  }
  return { messages: [], entries: [] };
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
  const [state, setState] = useState(loadState);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const speechSupported = Boolean(speechRecognitionCtor());
  const router = useRouter();

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Saklanamazsa sayfa yenilenince sohbet sıfırlanır.
    }
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state]);

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
    }) => {
      setBusy(true);
      try {
        const { data, error } =
          await supabase.functions.invoke<AssistantResponse>("nes-assistant", {
            body,
          });
        if (error) throw error;
        const response = data ?? {};
        setState((current) => ({
          messages: response.messages ?? body.messages,
          entries: [
            ...current.entries,
            {
              role: "assistant",
              text:
                response.reply ||
                (response.pending?.length
                  ? "Şu işlemi yapmamı onaylıyor musunuz?"
                  : ""),
              links: response.links,
              pending: response.pending,
            },
          ],
        }));
      } catch (error) {
        const text = await errorText(error);
        setState((current) => ({
          ...current,
          entries: [...current.entries, { role: "error", text }],
        }));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    recognitionRef.current?.stop();
    setInput("");
    const messages: ApiMessage[] = [
      ...state.messages,
      { role: "user", content: trimmed },
    ];
    setState((current) => ({
      messages,
      entries: [
        ...current.entries.map((entry) =>
          entry.pending && !entry.resolved
            ? { ...entry, resolved: "declined" as const }
            : entry,
        ),
        { role: "user", text: trimmed },
      ],
    }));
    void call({ messages });
  }

  function resolve(index: number, approved: boolean) {
    setState((current) => ({
      ...current,
      entries: current.entries.map((entry, i) =>
        i === index
          ? { ...entry, resolved: approved ? "approved" : "declined" }
          : entry,
      ),
    }));
    void call({ messages: state.messages, confirm: { approved } });
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

  function reset() {
    recognitionRef.current?.stop();
    setState({ messages: [], entries: [] });
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
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2 pr-8">
              <SheetTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" /> Asistan
              </SheetTitle>
              {state.entries.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  disabled={busy}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Yeni sohbet
                </Button>
              ) : null}
            </div>
            <SheetDescription>
              Yazın ya da mikrofona konuşun. Kayıt açmadan önce onayınızı
              isterim.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
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
              </div>
            ) : null}
            {state.entries.map((entry, index) => (
              <div
                key={index}
                className={
                  entry.role === "user"
                    ? "ml-8 rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : entry.role === "error"
                      ? "mr-8 rounded-2xl rounded-bl-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                      : "mr-8 rounded-2xl rounded-bl-md bg-muted px-3 py-2 text-sm"
                }
              >
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
                {entry.links?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.links.map((link, i) =>
                      link.href.startsWith("/") ? (
                        <Button
                          key={i}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 bg-background"
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
                          className="h-8 bg-background"
                        >
                          <a href={link.href} target="_blank" rel="noreferrer">
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
                <LoaderCircle className="h-4 w-4 animate-spin" /> Çalışıyorum...
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>

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
              disabled={busy || !input.trim()}
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
