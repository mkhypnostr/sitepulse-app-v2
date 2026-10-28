import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Eye, EyeOff, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// "Şifremi unuttum" e-postasındaki bağlantının açtığı sayfa.
// Bağlantıdaki tek kullanımlık anahtar sayfa açılırken değil, kullanıcı yeni
// şifresini kaydederken doğrulanır; böylece e-posta tarayıcılarının bağlantıyı
// önceden açması anahtarı harcamaz.

export const Route = createFileRoute("/sifre-yenile")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { token_hash?: string } => ({
    token_hash:
      typeof search.token_hash === "string" ? search.token_hash : undefined,
  }),
  component: ResetPasswordPage,
});

function passwordIsStrong(value: string) {
  return (
    value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function ResetPasswordPage() {
  const { token_hash: tokenHash } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strong = passwordIsStrong(password);
  const matches = password.length > 0 && password === confirm;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!tokenHash || !strong || !matches) return;
    setBusy(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: "recovery",
      });
      if (verifyError) {
        throw new Error(
          "Bağlantının süresi dolmuş veya daha önce kullanılmış. Giriş ekranından yeni bir bağlantı isteyin.",
        );
      }
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) {
        throw new Error(
          updateError.message.includes("different")
            ? "Yeni şifre eski şifrenizle aynı olamaz."
            : "Şifre kaydedilemedi. Lütfen tekrar deneyin.",
        );
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Şifre kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3 pb-2">
          <div className="inline-block w-fit rounded-xl bg-white p-2 shadow-sm">
            <img
              src="/nes-enerji-logo.png"
              alt="NES Enerji"
              className="h-7 w-auto"
            />
          </div>
          <CardTitle className="text-2xl font-black tracking-tight">
            {done ? "Şifreniz yenilendi" : "Yeni şifre belirleyin"}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {done ? (
            <div className="space-y-5">
              <p className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-highlight" />
                Yeni şifrenizle oturumunuz açıldı. Bundan sonra girişte bu
                şifreyi kullanın.
              </p>
              <Button
                className="h-12 w-full font-bold"
                onClick={() => window.location.assign("/dashboard")}
              >
                Uygulamaya geç
              </Button>
            </div>
          ) : !tokenHash ? (
            <div className="space-y-5">
              <p className="text-sm leading-6 text-muted-foreground">
                Bu sayfa, e-postanıza gelen şifre yenileme bağlantısıyla açılır.
                Bağlantı eksik görünüyor.
              </p>
              <Button
                variant="outline"
                className="h-12 w-full"
                onClick={() => window.location.assign("/")}
              >
                Giriş ekranına dön
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="grid gap-2 text-sm font-bold">
                Yeni şifre
                <div className="relative">
                  <Input
                    type={show ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className="h-12 bg-input pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShow(!show)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-highlight"
                    aria-label={show ? "Şifreyi gizle" : "Şifreyi göster"}
                  >
                    {show ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
              </label>
              <label className="grid gap-2 text-sm font-bold">
                Yeni şifre (tekrar)
                <Input
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="h-12 bg-input"
                />
              </label>
              <p
                className={`text-xs leading-5 ${password && !strong ? "text-destructive" : "text-muted-foreground"}`}
              >
                En az 12 karakter; büyük harf, küçük harf, rakam ve özel
                karakter (ör. ! ? . * #) içermelidir.
              </p>
              {confirm && !matches && (
                <p className="text-xs text-destructive">
                  İki şifre birbiriyle aynı değil.
                </p>
              )}
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                type="submit"
                className="h-12 w-full font-bold"
                disabled={busy || !strong || !matches}
              >
                <KeyRound className="mr-2 h-4 w-4" />
                {busy ? "Kaydediliyor..." : "Şifreyi kaydet"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
