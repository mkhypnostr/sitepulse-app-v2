import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  BriefcaseBusiness,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FolderKanban,
  Monitor,
  MoreVertical,
  Share2,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: IndexComponent,
});

function safeRedirect(value: string | undefined) {
  if (!value) return "/dashboard";
  return value.startsWith("/oauth/consent?authorization_id=") ? value : "/dashboard";
}

function IndexComponent() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [installInstructionsOpen, setInstallInstructionsOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const { user, loading } = useAuth();
  const { redirect } = Route.useSearch();

  useEffect(() => {
    if (!loading && user) window.location.assign(safeRedirect(redirect));
  }, [loading, redirect, user]);

  useEffect(() => {
    const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone === true;
    setIsInstalled(standalone);

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setInstallInstructionsOpen(false);
      toast.success("NES Saha Operasyon bu cihaza kuruldu");
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (isInstalled) return;
    if (!installPrompt) {
      setInstallInstructionsOpen(true);
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      toast.success("Kurulum başlatıldı");
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginInProgress(true);

    const normalizedIdentifier = identifier.trim();
    let error: Error | null = null;

    if (normalizedIdentifier.includes("@")) {
      const response = await supabase.auth.signInWithPassword({
        email: normalizedIdentifier.toLowerCase(),
        password,
      });
      error = response.error;
    } else {
      const { data, error: functionError } = await supabase.functions.invoke<{
        access_token?: string;
        refresh_token?: string;
        error?: string;
      }>("nes-username-login", {
        body: { username: normalizedIdentifier, password },
      });

      if (functionError || !data?.access_token || !data.refresh_token) {
        error = new Error(data?.error || "Kullanıcı adı veya şifre hatalı.");
      } else {
        const sessionResult = await supabase.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        error = sessionResult.error;
      }
    }

    if (error) {
      toast.error("Giriş başarısız: " + error.message);
      setLoginInProgress(false);
    } else {
      toast.success("Giriş başarılı!");
      window.location.assign(safeRedirect(redirect));
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 font-semibold text-[#0046a4]">
        Sistem kontrol ediliyor...
      </div>
    );
  }

  return (
    <main className="login-page min-h-screen bg-slate-50 text-slate-950">
      <div className="login-layout mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.15fr_0.85fr]">
        <section className="login-intro login-energy-light flex items-center px-6 py-10 sm:px-10 lg:px-16 lg:py-16">
          <div className="login-intro-content mx-auto w-full max-w-2xl">
            <div className="login-brand flex items-center gap-3">
              <img
                src="/app-icon.svg"
                alt="NES Enerji"
                className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-cover shadow-sm"
              />
              <div>
                <p className="text-xl font-black tracking-tight text-slate-950">NES ENERJİ</p>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#0046a4]">
                  Saha Operasyon Platformu
                </p>
              </div>
            </div>

            <div className="login-divider mt-10 h-1 w-16 rounded-full bg-[#0046a4]" />
            <h1 className="login-headline mt-6 max-w-xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Saha ve proje süreçleriniz,
              <span className="block text-[#0046a4]">size özel panelde.</span>
            </h1>
            <p className="login-description mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              NES Enerji tarafından size açılan işlere, proje ilerlemesine, fotoğraflara ve
              raporlara güvenli şekilde ulaşın.
            </p>

            <div className="login-role-grid mt-8 grid gap-3 sm:grid-cols-3">
              {[
                {
                  icon: BriefcaseBusiness,
                  label: "Taşeron Paneli",
                  description: "Atanan işleri, ilerlemeyi ve saha kayıtlarını yönetin.",
                },
                {
                  icon: FolderKanban,
                  label: "Müşteri Paneli",
                  description: "Proje durumunu, fotoğrafları ve raporları takip edin.",
                },
                {
                  icon: ShieldCheck,
                  label: "Güvenli Erişim",
                  description: "Yalnızca size yetki verilen bilgileri görün.",
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="login-role-card rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
                >
                  <item.icon className="h-5 w-5 text-[#0046a4]" />
                  <p className="login-role-label mt-3 text-sm font-black text-slate-950">
                    {item.label}
                  </p>
                  <p className="login-role-description mt-1 text-xs leading-5 text-slate-500">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="login-form-section login-energy-dark flex items-center justify-center border-t border-slate-200 px-6 py-10 lg:border-l lg:border-t-0 lg:px-12">
          <Card className="login-card w-full max-w-md border-slate-200 bg-white shadow-xl shadow-slate-200/60">
            <CardHeader className="login-card-header space-y-3 pb-2">
              <div className="login-security-badge inline-flex w-fit items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0046a4]">
                <ShieldCheck className="h-4 w-4" /> Güvenli giriş
              </div>
              <CardTitle className="login-card-title text-3xl font-black tracking-tight text-slate-950">
                Size tanımlanan hesabınızla giriş yapın
              </CardTitle>
              <p className="login-card-subtitle text-sm leading-6 text-slate-500">
                NES Enerji tarafından iletilen kullanıcı adı veya e-posta ile geçici şifrenizi kullanın.
              </p>
            </CardHeader>
            <CardContent className="login-card-content pt-6">
              <form onSubmit={handleLogin} className="login-form space-y-5">
                <label className="login-field grid gap-2 text-sm font-bold text-slate-800">
                  Kullanıcı adı veya e-posta
                  <Input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    autoComplete="username"
                    placeholder="ornek.kullanici veya ornek@firma.com"
                    className="login-input h-12 border-slate-300 bg-white text-slate-950 placeholder:text-slate-400 focus-visible:ring-[#0046a4]"
                  />
                </label>
                <label className="login-field grid gap-2 text-sm font-bold text-slate-800">
                  Şifre
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="login-input h-12 border-slate-300 bg-white pr-11 text-slate-950 placeholder:text-slate-400 focus-visible:ring-[#0046a4]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-[#0046a4]"
                      aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                    >
                      {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </label>
                <Button
                  type="submit"
                  className="login-submit mt-2 h-12 w-full bg-[#0046a4] text-base font-bold text-white hover:bg-[#00377f]"
                  disabled={loginInProgress}
                >
                  {loginInProgress ? "Giriş yapılıyor..." : "Giriş Yap"}
                </Button>
              </form>
              <div className="login-install mt-4 border-t border-slate-200 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleInstall}
                  disabled={isInstalled}
                  className="login-install-button h-14 w-full justify-start border-[#0046a4]/30 bg-blue-50 px-4 text-left text-[#0046a4] hover:border-[#0046a4] hover:bg-blue-100 hover:text-[#00377f]"
                >
                  {isInstalled ? (
                    <CheckCircle2 className="mr-3 h-6 w-6 shrink-0" />
                  ) : (
                    <Download className="mr-3 h-6 w-6 shrink-0" />
                  )}
                  <span>
                    <span className="block font-black">
                      {isInstalled ? "Bu cihazda kurulu" : "Cihazıma Kur"}
                    </span>
                    <span className="block text-xs font-medium text-slate-500">
                      Telefon, tablet veya bilgisayara ekleyin
                    </span>
                  </span>
                </Button>
              </div>
              <p className="login-help mt-6 text-center text-xs leading-5 text-slate-500">
                Hesabınız yoksa veya giriş yapamıyorsanız NES Enerji yetkilinizle iletişime geçin.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>

      <Dialog open={installInstructionsOpen} onOpenChange={setInstallInstructionsOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-[#164361] bg-[#061827] text-white sm:max-w-lg">
          <DialogHeader>
            <div className="mb-2 inline-flex w-fit items-center gap-2 rounded-full bg-cyan-400/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-cyan-300">
              <Download className="h-4 w-4" /> Uygulama kurulumu
            </div>
            <DialogTitle className="text-2xl font-black text-white">
              Cihazınıza nasıl kurulur?
            </DialogTitle>
            <DialogDescription className="leading-6 text-slate-300">
              Kullandığınız cihazın altındaki kısa adımları uygulayın.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 pt-2">
            <div className="rounded-xl border border-[#1d506f] bg-[#092238] p-4">
              <div className="flex gap-3">
                <Share2 className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
                <div>
                  <h3 className="font-black">iPhone / iPad</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Tarayıcıdaki <strong className="text-white">Paylaş</strong> simgesine basın,
                    aşağı kaydırın, <strong className="text-white">Ana Ekrana Ekle</strong> ve
                    ardından <strong className="text-white">Ekle</strong> seçeneğine basın.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#1d506f] bg-[#092238] p-4">
              <div className="flex gap-3">
                <MoreVertical className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
                <div>
                  <h3 className="font-black">Android telefon / tablet</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Chrome'da sağ üstteki <strong className="text-white">üç noktaya</strong> basın.
                    <strong className="text-white"> Uygulamayı yükle</strong> veya
                    <strong className="text-white"> Ana ekrana ekle</strong> seçeneğine basın.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#1d506f] bg-[#092238] p-4">
              <div className="flex gap-3">
                <Monitor className="mt-0.5 h-6 w-6 shrink-0 text-cyan-300" />
                <div>
                  <h3 className="font-black">Windows / Mac bilgisayar</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    Chrome veya Edge adres çubuğundaki
                    <strong className="text-white"> uygulama yükleme simgesine</strong> basın. Simge
                    görünmüyorsa sağ üst menüden{" "}
                    <strong className="text-white">Uygulamayı yükle</strong>
                    seçeneğini açın.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-1 flex items-center gap-3 rounded-xl bg-emerald-400/10 p-4 text-sm text-emerald-100">
            <Smartphone className="h-5 w-5 shrink-0 text-emerald-300" />
            Kurulumdan sonra mavi NES simgesi ana ekranda veya masaüstünde görünür.
          </div>

          <Button
            type="button"
            onClick={() => setInstallInstructionsOpen(false)}
            className="mt-2 h-12 w-full bg-cyan-400 font-black text-[#061827] hover:bg-cyan-300"
          >
            Anladım
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
