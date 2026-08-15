import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage, roleLabels, type AppRole } from "@/lib/domain";
import {
  AccessDenied,
  EmptyState,
  LoadingState,
  PageHeader,
} from "@/components/page-states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/team")({
  component: TeamPage,
});

const emptyContractorForm = {
  fullName: "",
  companyName: "",
  phone: "",
  username: "",
  email: "",
  temporaryPassword: "",
};

type CreateUserRpcResponse = {
  error?: { message?: string };
  result?: {
    isError?: boolean;
    structuredContent?: { success?: boolean; error?: string };
  };
};

type EditableRole = Exclude<AppRole, "admin">;
const editableRoles: EditableRole[] = ["contractor", "customer"];
// Yönetici rolü giriş e-postası değiştirme ekranından asla verilemez veya kaldırılamaz.
const assignableNonAdminRoles: EditableRole[] = [
  "technical_office",
  "contractor",
  "customer",
];

function emailIsValid(value: string) {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) &&
    value.trim().length <= 254
  );
}

function passwordIsValid(value: string) {
  return (
    value.length >= 12 &&
    value.length <= 128 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /\d/.test(value) &&
    /[^A-Za-z0-9]/.test(value)
  );
}

function usernameIsValid(value: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(value);
}

function TeamPage() {
  const { role } = useAuth();
  const canManageContractors = role === "admin" || role === "technical_office";
  const isAdmin = role === "admin";
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [contractorForm, setContractorForm] = useState(emptyContractorForm);
  const [resetTarget, setResetTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [emailChangeTarget, setEmailChangeTarget] = useState<{
    id: string;
    name: string;
    currentEmail: string | null;
    currentRole: AppRole;
  } | null>(null);
  const [emailChangeConfirming, setEmailChangeConfirming] = useState(false);
  const [newLoginEmail, setNewLoginEmail] = useState("");
  const [newLoginRole, setNewLoginRole] = useState<AppRole>("customer");
  const teamQuery = useQuery({
    queryKey: ["team"],
    enabled: canManageContractors,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "list_operational_team_members",
      );
      if (error) throw error;
      return data;
    },
  });

  const roleMutation = useMutation({
    mutationFn: async ({
      userId,
      newRole,
    }: {
      userId: string;
      newRole: EditableRole;
    }) => {
      const { error } = await supabase.rpc("set_user_role", {
        target_user_id: userId,
        new_role: newRole,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team"] });
      toast.success("Kullanıcı rolü güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createContractorMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "nes-user-management",
        {
          body: {
            jsonrpc: "2.0",
            id: crypto.randomUUID(),
            method: "tools/call",
            params: {
              name: "create_nes_user",
              arguments: {
                username: contractorForm.username.trim().toLowerCase(),
                email: contractorForm.email.trim().toLowerCase() || null,
                full_name: contractorForm.fullName.trim(),
                company_name: contractorForm.companyName.trim() || null,
                phone: contractorForm.phone.trim() || null,
                role: "contractor",
                temporary_password: contractorForm.temporaryPassword,
              },
            },
          },
        },
      );

      if (error) throw error;
      const response = data as CreateUserRpcResponse | null;
      const result = response?.result?.structuredContent;
      if (response?.error?.message) throw new Error(response.error.message);
      if (response?.result?.isError || !result?.success) {
        throw new Error(result?.error || "Taşeron hesabı oluşturulamadı.");
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-work-orders"] }),
      ]);
      setContractorForm(emptyContractorForm);
      setConfirming(false);
      setShowPassword(false);
      setCreateOpen(false);
      toast.success("Taşeron hesabı oluşturuldu");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!resetTarget)
        throw new Error("Şifresi yenilenecek kullanıcı seçilmedi.");
      const { data, error } = await supabase.functions.invoke(
        "nes-user-management",
        {
          body: {
            jsonrpc: "2.0",
            id: crypto.randomUUID(),
            method: "tools/call",
            params: {
              name: "reset_nes_user_password",
              arguments: {
                target_user_id: resetTarget.id,
                temporary_password: resetPassword,
              },
            },
          },
        },
      );
      if (error) throw error;
      const response = data as CreateUserRpcResponse | null;
      const result = response?.result?.structuredContent;
      if (response?.error?.message) throw new Error(response.error.message);
      if (response?.result?.isError || !result?.success) {
        throw new Error(result?.error || "Şifre yenilenemedi.");
      }
    },
    onSuccess: () => {
      setResetTarget(null);
      setResetPassword("");
      setShowResetPassword(false);
      toast.success("Geçici şifre yenilendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const closeEmailChangeDialog = () => {
    setEmailChangeTarget(null);
    setEmailChangeConfirming(false);
    setNewLoginEmail("");
  };

  const openEmailChangeDialog = (member: {
    id: string;
    full_name: string | null;
    email: string | null;
    role: AppRole;
  }) => {
    setEmailChangeTarget({
      id: member.id,
      name: member.full_name || "Bu kullanıcı",
      currentEmail: member.email,
      currentRole: member.role,
    });
    setEmailChangeConfirming(false);
    setNewLoginEmail("");
    setNewLoginRole(member.role);
  };

  const updateEmailMutation = useMutation({
    mutationFn: async () => {
      if (!emailChangeTarget) throw new Error("Kullanıcı seçilmedi.");
      const trimmedEmail = newLoginEmail.trim().toLowerCase();
      const roleChanged = newLoginRole !== emailChangeTarget.currentRole;
      const { data, error } = await supabase.functions.invoke(
        "nes-user-management",
        {
          body: {
            jsonrpc: "2.0",
            id: crypto.randomUUID(),
            method: "tools/call",
            params: {
              name: "update_nes_user_email",
              arguments: {
                target_user_id: emailChangeTarget.id,
                new_email: trimmedEmail,
                ...(roleChanged ? { new_role: newLoginRole } : {}),
              },
            },
          },
        },
      );

      if (error) throw error;
      const response = data as CreateUserRpcResponse | null;
      const result = response?.result?.structuredContent;
      if (response?.error?.message) throw new Error(response.error.message);
      if (response?.result?.isError || !result?.success) {
        throw new Error(result?.error || "Giriş e-postası değiştirilemedi.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["team"] });
      closeEmailChangeDialog();
      toast.success("Giriş e-postası güncellendi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const emailChangeFormValid =
    Boolean(emailChangeTarget) &&
    emailIsValid(newLoginEmail) &&
    newLoginEmail.trim().toLowerCase() !==
      (emailChangeTarget?.currentEmail ?? "").toLowerCase();

  const formIsValid =
    contractorForm.fullName.trim().length >= 2 &&
    usernameIsValid(contractorForm.username.trim().toLowerCase()) &&
    (!contractorForm.email.trim() ||
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contractorForm.email.trim())) &&
    passwordIsValid(contractorForm.temporaryPassword);

  const handleCreateOpenChange = (open: boolean) => {
    if (createContractorMutation.isPending) return;
    setCreateOpen(open);
    if (!open) {
      setConfirming(false);
      setShowPassword(false);
      setContractorForm(emptyContractorForm);
    }
  };

  if (!canManageContractors) return <AccessDenied />;
  if (teamQuery.isLoading) return <LoadingState />;

  const members = teamQuery.data ?? [];
  const createButton = (
    <Dialog open={createOpen} onOpenChange={handleCreateOpenChange}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold">
          <Plus className="mr-2 h-4 w-4" /> Yeni Taşeron
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {confirming ? (
          <>
            <DialogHeader>
              <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-warning/15 text-warning">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <DialogTitle>Taşeron hesabını oluşturun mu?</DialogTitle>
              <DialogDescription>
                Bu işlem gerçek bir giriş hesabı oluşturur. Bilgileri son kez
                kontrol edin.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Ad Soyad</p>
                <p className="font-bold">{contractorForm.fullName.trim()}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Firma</p>
                  <p className="font-semibold">
                    {contractorForm.companyName.trim() || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefon</p>
                  <p className="font-semibold">
                    {contractorForm.phone.trim() || "—"}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Kullanıcı adı</p>
                <p className="font-semibold">
                  {contractorForm.username.trim().toLowerCase()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">E-posta</p>
                <p className="break-all font-semibold">
                  {contractorForm.email.trim() || "Sonra eklenecek"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Rol</p>
                <p className="font-bold text-highlight">Taşeron</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Geçici şifre ekranda tekrar gösterilmez ve sistem kayıtlarına
              yazılmaz. Şifreyi taşerona güvenli bir kanaldan iletin.
            </p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={createContractorMutation.isPending}
              >
                Geri
              </Button>
              <Button
                type="button"
                onClick={() => createContractorMutation.mutate()}
                disabled={createContractorMutation.isPending}
              >
                {createContractorMutation.isPending
                  ? "Oluşturuluyor..."
                  : "Taşeronu Oluştur"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Yeni taşeron hesabı</DialogTitle>
              <DialogDescription>
                Taşeron kullanıcı adı veya e-posta ile, geçici şifresini
                kullanarak yalnızca kendisine atanan işleri görür.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  Ad Soyad <span className="text-destructive">*</span>
                </span>
                <Input
                  value={contractorForm.fullName}
                  onChange={(event) =>
                    setContractorForm({
                      ...contractorForm,
                      fullName: event.target.value,
                    })
                  }
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Örnek: Ahmet Yılmaz"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium">
                  Firma
                  <Input
                    value={contractorForm.companyName}
                    onChange={(event) =>
                      setContractorForm({
                        ...contractorForm,
                        companyName: event.target.value,
                      })
                    }
                    maxLength={160}
                    autoComplete="organization"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Telefon
                  <Input
                    value={contractorForm.phone}
                    onChange={(event) =>
                      setContractorForm({
                        ...contractorForm,
                        phone: event.target.value,
                      })
                    }
                    maxLength={40}
                    autoComplete="tel"
                    placeholder="+90 5xx xxx xx xx"
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  Kullanıcı adı <span className="text-destructive">*</span>
                </span>
                <Input
                  value={contractorForm.username}
                  onChange={(event) =>
                    setContractorForm({
                      ...contractorForm,
                      username: event.target.value.toLowerCase(),
                    })
                  }
                  maxLength={32}
                  autoComplete="username"
                  placeholder="ornek: ahmet.yilmaz"
                />
                <span className="text-xs font-normal leading-5 text-muted-foreground">
                  3-32 karakter; yalnızca küçük harf, rakam, nokta, tire ve alt
                  çizgi kullanın.
                </span>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                E-posta{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  (isteğe bağlı)
                </span>
                <Input
                  type="email"
                  value={contractorForm.email}
                  onChange={(event) =>
                    setContractorForm({
                      ...contractorForm,
                      email: event.target.value,
                    })
                  }
                  maxLength={254}
                  autoComplete="email"
                  placeholder="ornek@firma.com"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                <span>
                  Geçici Şifre <span className="text-destructive">*</span>
                </span>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={contractorForm.temporaryPassword}
                    onChange={(event) =>
                      setContractorForm({
                        ...contractorForm,
                        temporaryPassword: event.target.value,
                      })
                    }
                    minLength={12}
                    maxLength={128}
                    autoComplete="new-password"
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-highlight"
                    aria-label={
                      showPassword ? "Şifreyi gizle" : "Şifreyi göster"
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <span className="text-xs font-normal leading-5 text-muted-foreground">
                  En az 12 karakter; büyük harf, küçük harf, rakam ve özel
                  karakter içermelidir.
                </span>
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!formIsValid}
              >
                Bilgileri Kontrol Et
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title={isAdmin ? "Ekip ve Yetkiler" : "Taşeronlar"}
        description={
          isAdmin
            ? "Taşeron ve müşteri rollerini yönetin. Yönetici ve teknik ofis hesapları güvenlik nedeniyle bu ekranda kilitlidir."
            : "Taşeron hesapları oluşturun ve iletişim bilgilerini görüntüleyin. Rol ve şifre işlemleri yöneticidedir."
        }
        actions={createButton}
      />
      {members.length === 0 ? (
        <EmptyState
          title="Kullanıcı profili bulunamadı"
          description="İlk taşeron hesabını doğrudan bu ekrandan oluşturabilirsiniz."
          action={createButton}
        />
      ) : (
        <section className="surface-panel overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-black">Ekip Kayıtları</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Kullanıcı, firma ve rol bilgilerini tek listede takip edin.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kullanıcı</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead className="w-56">Rol</TableHead>
                {isAdmin ? (
                  <TableHead className="w-64">İşlemler</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-bold">
                    {member.full_name || "İsimsiz kullanıcı"}
                    {isAdmin && member.email ? (
                      <p className="mt-0.5 text-xs font-normal text-muted-foreground">
                        {member.email}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.company_name || "—"}</TableCell>
                  <TableCell>{member.phone || "—"}</TableCell>
                  <TableCell>
                    {member.role === "admin" ||
                    member.role === "technical_office" ? (
                      <div className="inline-flex h-11 min-w-48 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 font-bold text-highlight">
                        <ShieldCheck className="h-4 w-4" />
                        <span>
                          {member.role === "admin" ? "Yönetici" : "Teknik Ofis"}{" "}
                          — Korumalı
                        </span>
                      </div>
                    ) : isAdmin ? (
                      <Select
                        value={member.role}
                        disabled={roleMutation.isPending}
                        onValueChange={(newRole: EditableRole) =>
                          roleMutation.mutate({ userId: member.id, newRole })
                        }
                      >
                        <SelectTrigger className="h-11">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {editableRoles.map((itemRole) => (
                            <SelectItem key={itemRole} value={itemRole}>
                              {roleLabels[itemRole]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="inline-flex h-11 items-center rounded-md border border-border bg-muted/30 px-3 text-sm font-bold">
                        {roleLabels[member.role]}
                      </span>
                    )}
                  </TableCell>
                  {isAdmin ? (
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openEmailChangeDialog(member)}
                        >
                          <Mail className="mr-2 h-4 w-4" /> E-postayı Değiştir
                        </Button>
                        {member.role === "admin" ||
                        member.role === "technical_office" ? null : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setResetTarget({
                                id: member.id,
                                name: member.full_name || "Bu kullanıcı",
                              })
                            }
                          >
                            <KeyRound className="mr-2 h-4 w-4" /> Şifre Yenile
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 text-highlight" />{" "}
        {isAdmin
          ? "Yönetici ve teknik ofis rolleri korumalıdır. Bu ekrandan yalnızca taşeron ve müşteri rolleri değiştirilebilir; geçici şifreler kaydedilmez."
          : "Bu ekran yalnızca taşeron oluşturma ve iletişim bilgisini görüntüleme içindir; rol ve şifre değiştirilemez."}
      </div>
      <Dialog
        open={Boolean(resetTarget)}
        onOpenChange={(open) => {
          if (!open && !resetPasswordMutation.isPending) {
            setResetTarget(null);
            setResetPassword("");
            setShowResetPassword(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Geçici şifreyi yenile</DialogTitle>
            <DialogDescription>
              {resetTarget?.name} için yeni geçici şifre belirleyin. Bu işlem
              kullanıcının mevcut şifresini hemen değiştirir.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium">
            Yeni geçici şifre
            <div className="relative">
              <Input
                type={showResetPassword ? "text" : "password"}
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowResetPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-label={
                  showResetPassword ? "Şifreyi gizle" : "Şifreyi göster"
                }
              >
                {showResetPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <span className="text-xs font-normal text-muted-foreground">
              En az 12 karakter; büyük/küçük harf, rakam ve özel karakter
              içermelidir.
            </span>
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setResetTarget(null)}
              disabled={resetPasswordMutation.isPending}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => resetPasswordMutation.mutate()}
              disabled={
                !passwordIsValid(resetPassword) ||
                resetPasswordMutation.isPending
              }
            >
              {resetPasswordMutation.isPending
                ? "Yenileniyor..."
                : "Şifreyi Yenile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(emailChangeTarget)}
        onOpenChange={(open) => {
          if (!open && !updateEmailMutation.isPending) closeEmailChangeDialog();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {emailChangeConfirming && emailChangeTarget ? (
            <>
              <DialogHeader>
                <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-warning/15 text-warning">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <DialogTitle>Giriş e-postasını değiştirin mi?</DialogTitle>
                <DialogDescription>
                  Bu işlem hemen uygulanır. Eski e-posta ile giriş kesilir;
                  şifre ve kullanıcı kimliği korunur.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 rounded-xl border border-border bg-muted/30 p-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Kullanıcı</p>
                  <p className="font-bold">{emailChangeTarget.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Mevcut e-posta
                  </p>
                  <p className="break-all font-semibold">
                    {emailChangeTarget.currentEmail || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Yeni e-posta</p>
                  <p className="break-all font-bold text-highlight">
                    {newLoginEmail.trim().toLowerCase()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rol</p>
                  {newLoginRole === emailChangeTarget.currentRole ? (
                    <p className="font-semibold">
                      {roleLabels[emailChangeTarget.currentRole]} (değişmeyecek)
                    </p>
                  ) : (
                    <p className="font-bold text-highlight">
                      {roleLabels[emailChangeTarget.currentRole]} →{" "}
                      {roleLabels[newLoginRole]}
                    </p>
                  )}
                </div>
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEmailChangeConfirming(false)}
                  disabled={updateEmailMutation.isPending}
                >
                  Geri
                </Button>
                <Button
                  type="button"
                  onClick={() => updateEmailMutation.mutate()}
                  disabled={updateEmailMutation.isPending}
                >
                  {updateEmailMutation.isPending
                    ? "Güncelleniyor..."
                    : "E-postayı Değiştir"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Giriş e-postasını değiştir</DialogTitle>
                <DialogDescription>
                  {emailChangeTarget?.name} için yeni kurumsal giriş e-postası
                  belirleyin. İsteğe bağlı olarak rolü de güncelleyebilirsiniz.
                  Bu işlem yalnızca yöneticiler tarafından yapılabilir.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                <label className="grid gap-1.5 text-sm font-medium">
                  Mevcut e-posta
                  <Input
                    value={emailChangeTarget?.currentEmail || "—"}
                    disabled
                    readOnly
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  <span>
                    Yeni giriş e-postası{" "}
                    <span className="text-destructive">*</span>
                  </span>
                  <Input
                    type="email"
                    value={newLoginEmail}
                    onChange={(event) => setNewLoginEmail(event.target.value)}
                    maxLength={254}
                    autoComplete="email"
                    placeholder="ornek@nesgrup.com"
                  />
                </label>
                {emailChangeTarget?.currentRole === "admin" ? (
                  <div className="grid gap-1.5 text-sm font-medium">
                    <span>Rol</span>
                    <div className="inline-flex h-11 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 font-bold text-highlight">
                      <ShieldCheck className="h-4 w-4" />
                      <span>Yönetici — Korumalı</span>
                    </div>
                    <span className="text-xs font-normal leading-5 text-muted-foreground">
                      Yönetici hesabının rolü bu ekrandan değiştirilemez;
                      yalnızca e-posta güncellenir.
                    </span>
                  </div>
                ) : (
                  <label className="grid gap-1.5 text-sm font-medium">
                    Rol
                    <Select
                      value={newLoginRole}
                      onValueChange={(value: EditableRole) =>
                        setNewLoginRole(value)
                      }
                    >
                      <SelectTrigger className="h-11">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {assignableNonAdminRoles.map((itemRole) => (
                          <SelectItem key={itemRole} value={itemRole}>
                            {roleLabels[itemRole]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs font-normal leading-5 text-muted-foreground">
                      Mevcut rolü korumak için değiştirmeden bırakın.
                    </span>
                  </label>
                )}
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  onClick={() => setEmailChangeConfirming(true)}
                  disabled={!emailChangeFormValid}
                >
                  Bilgileri Kontrol Et
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
