import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Boxes, BriefcaseBusiness, Eye, EyeOff, ShieldCheck, UsersRound } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  component: IndexComponent,
});

function IndexComponent() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate({ to: "/dashboard", replace: true });
  }, [loading, navigate, user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginInProgress(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      toast.error("Giriş başarısız: " + error.message);
      setLoginInProgress(false);
    } else {
      toast.success("Giriş başarılı!");
      window.location.assign("/dashboard");
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
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[1.15fr_0.85fr]">
        <section className="flex items-center px-6 py-10 sm:px-10 lg:px-16 lg:py-16">
          <div className="mx-auto w-full max-w-2xl">
            <div className="flex items-center gap-3">
              <img
                src="/app-icon.svg"
                alt="NES Enerji"
                className="h-14 w-14 rounded-xl border border-slate-200 bg-white object-cover shadow-sm"
              />
              <div>
                <p className="text-xl font-black tracking-tight text-slate-950">NES ENERJİ</p>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#0046a4]">
                  İş Takip Platformu
                </p>
              </div>
            </div>

            <div className="mt-10 h-1 w-16 rounded-full bg-[#0046a4]" />
            <h1 className="mt-6 max-w-xl text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              Saha operasyonunuz
              <span className="block text-[#0046a4]">tek, güvenli panelde.</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
              İş emirlerini planlayın, taşeronları yönetin, stok ve ilerleme durumunu anlık
              takip edin.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {[
                { icon: BriefcaseBusiness, label: "İş Emirleri" },
                { icon: UsersRound, label: "Ekip Yönetimi" },
                { icon: Boxes, label: "Stok Takibi" },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm font-bold shadow-sm"
                >
                  <item.icon className="h-5 w-5 shrink-0 text-[#0046a4]" />
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center border-t border-slate-200 bg-white px-6 py-10 lg:border-l lg:border-t-0 lg:px-12">
          <Card className="w-full max-w-md border-slate-200 bg-white shadow-xl shadow-slate-200/60">
            <CardHeader className="space-y-3 pb-2">
              <div className="inline-flex w-fit items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-[#0046a4]">
                <ShieldCheck className="h-4 w-4" /> Güvenli giriş
              </div>
              <CardTitle className="text-3xl font-black tracking-tight text-slate-950">
                Hesabınıza giriş yapın
              </CardTitle>
              <p className="text-sm leading-6 text-slate-500">
                Size tanımlanan e-posta ve şifreyi kullanın.
              </p>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleLogin} className="space-y-5">
                <label className="grid gap-2 text-sm font-bold text-slate-800">
                  E-posta
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="ornek@nesenerji.com"
                    className="h-12 border-slate-300 bg-white text-slate-950 placeholder:text-slate-400 focus-visible:ring-[#0046a4]"
                  />
                </label>
                <label className="grid gap-2 text-sm font-bold text-slate-800">
                  Şifre
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-12 border-slate-300 bg-white pr-11 text-slate-950 placeholder:text-slate-400 focus-visible:ring-[#0046a4]"
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
                  className="mt-2 h-12 w-full bg-[#0046a4] text-base font-bold text-white hover:bg-[#00377f]"
                  disabled={loginInProgress}
                >
                  {loginInProgress ? "Giriş yapılıyor..." : "Giriş Yap"}
                </Button>
              </form>
              <p className="mt-6 text-center text-xs leading-5 text-slate-500">
                Hesap ve yetki işlemleri NES Enerji yöneticisi tarafından yapılır.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
