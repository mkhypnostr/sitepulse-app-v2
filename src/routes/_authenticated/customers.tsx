import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
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

export const Route = createFileRoute("/_authenticated/customers")({
  component: CustomersPage,
});

const emptyAccountForm = {
  fullName: "",
  username: "",
  email: "",
  phone: "",
  temporaryPassword: "",
};

type CreateUserRpcResponse = {
  error?: { message?: string };
  result?: {
    isError?: boolean;
    structuredContent?: { success?: boolean; error?: string };
  };
};

function usernameIsValid(value: string) {
  return /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])$/.test(value);
}

function emailIsValid(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
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

function CustomersPage() {
  const { role } = useAuth();
  const canManageCustomers = role === "admin" || role === "technical_office";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<{
    id: string;
    name: string;
    contact: string | null;
    contact_user_id: string | null;
    billing_title: string | null;
    tax_office: string | null;
    tax_no: string | null;
    billing_address: string | null;
  } | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [contactUserId, setContactUserId] = useState<string>("none");
  const [billingTitle, setBillingTitle] = useState("");
  const [taxOffice, setTaxOffice] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [accountTarget, setAccountTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [accountForm, setAccountForm] = useState(emptyAccountForm);
  const [showAccountPassword, setShowAccountPassword] = useState(false);

  const customersQuery = useQuery({
    queryKey: ["customers"],
    enabled: canManageCustomers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const customerUsersQuery = useQuery({
    queryKey: ["customer-users"],
    enabled: role === "admin",
    queryFn: async () => {
      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "customer");
      if (roleError) throw roleError;
      const ids = roles.map((item) => item.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, company_name")
        .in("id", ids)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const resetCustomerForm = () => {
    setEditingCustomer(null);
    setName("");
    setContact("");
    setContactUserId("none");
    setBillingTitle("");
    setTaxOffice("");
    setTaxNo("");
    setBillingAddress("");
  };

  const saveCustomer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("save_customer_details", {
        customer_name: name.trim(),
        customer_contact: contact.trim(),
        customer_billing_title: billingTitle.trim(),
        customer_tax_office: taxOffice.trim(),
        customer_tax_no: taxNo.trim(),
        customer_billing_address: billingAddress.trim(),
        target_contact_user_id:
          role === "admin" && contactUserId !== "none"
            ? contactUserId
            : undefined,
        target_customer_id: editingCustomer?.id ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      const wasEditing = Boolean(editingCustomer);
      resetCustomerForm();
      setOpen(false);
      toast.success(wasEditing ? "Müşteri güncellendi" : "Müşteri kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const createCustomerAccount = useMutation({
    mutationFn: async () => {
      if (!accountTarget)
        throw new Error("Portal hesabı açılacak müşteri seçilmedi.");

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
                username: accountForm.username.trim().toLowerCase(),
                email: accountForm.email.trim().toLowerCase() || null,
                full_name: accountForm.fullName.trim(),
                company_name: accountTarget.name,
                phone: accountForm.phone.trim() || null,
                role: "customer",
                customer_id: accountTarget.id,
                temporary_password: accountForm.temporaryPassword,
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
        throw new Error(
          result?.error || "Müşteri portal hesabı oluşturulamadı.",
        );
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["customers"] }),
        queryClient.invalidateQueries({ queryKey: ["customer-users"] }),
        queryClient.invalidateQueries({ queryKey: ["team"] }),
      ]);
      setAccountTarget(null);
      setAccountForm(emptyAccountForm);
      setShowAccountPassword(false);
      toast.success("Müşteri portal hesabı oluşturuldu ve firmaya bağlandı");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteCustomer = useMutation({
    mutationFn: async (customerId: string) => {
      const [workOrdersResult, projectsResult] = await Promise.all([
        supabase
          .from("work_orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customerId),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", customerId),
      ]);

      if (workOrdersResult.error) throw workOrdersResult.error;
      if (projectsResult.error) throw projectsResult.error;

      const relatedRecordCount =
        (workOrdersResult.count ?? 0) + (projectsResult.count ?? 0);
      if (relatedRecordCount > 0) {
        throw new Error(
          "Bu müşteriye bağlı proje veya görev bulunduğu için silinemez. Önce bağlı kayıtları başka bir müşteriye taşıyın ya da kapatın.",
        );
      }

      const { error } = await supabase
        .from("customers")
        .delete()
        .eq("id", customerId);
      if (error?.code === "23503") {
        throw new Error(
          "Bu müşteri proje veya görevlerde kullanıldığı için silinemez.",
        );
      }
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Müşteri silindi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManageCustomers) return <AccessDenied />;
  if (customersQuery.isLoading) return <LoadingState />;

  const customers = customersQuery.data ?? [];
  const customerUsers = customerUsersQuery.data ?? [];
  const profileById = new Map(
    customerUsers.map((profile) => [profile.id, profile]),
  );
  const linkedCustomerUserIds = new Set(
    customers
      .map((customer) => customer.contact_user_id)
      .filter((userId): userId is string => Boolean(userId)),
  );
  const selectableCustomerUsers = customerUsers.filter(
    (profile) =>
      profile.id === editingCustomer?.contact_user_id ||
      !linkedCustomerUserIds.has(profile.id),
  );
  const accountFormIsValid =
    Boolean(accountTarget) &&
    accountForm.fullName.trim().length >= 2 &&
    usernameIsValid(accountForm.username.trim().toLowerCase()) &&
    (!accountForm.email.trim() || emailIsValid(accountForm.email.trim())) &&
    passwordIsValid(accountForm.temporaryPassword);
  const beginEdit = (customer: (typeof customers)[number]) => {
    setEditingCustomer(customer);
    setName(customer.name);
    setContact(customer.contact ?? "");
    setContactUserId(customer.contact_user_id ?? "none");
    setBillingTitle(customer.billing_title ?? "");
    setTaxOffice(customer.tax_office ?? "");
    setTaxNo(customer.tax_no ?? "");
    setBillingAddress(customer.billing_address ?? "");
    setOpen(true);
  };

  const createButton = (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) resetCustomerForm();
      }}
    >
      <DialogTrigger asChild>
        <Button className="h-12 font-bold" onClick={resetCustomerForm}>
          <Plus className="mr-2 h-4 w-4" /> Yeni Müşteri
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editingCustomer ? "Müşteriyi düzenle" : "Yeni müşteri oluştur"}
          </DialogTitle>
          <DialogDescription>
            Var olan portal hesabını eşleştirin. Hesap yoksa müşteri kartındaki
            “Portal Hesabı Aç” işlemini kullanın.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Müşteri / Firma Adı
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            İletişim Bilgisi
            <Input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              placeholder="Telefon veya e-posta"
            />
          </label>
          {role === "admin" ? (
            <label className="grid gap-1.5 text-sm font-medium">
              Portal Kullanıcısı
              <Select value={contactUserId} onValueChange={setContactUserId}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Kullanıcı seçin" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Henüz eşleştirme</SelectItem>
                  {selectableCustomerUsers.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.full_name || "İsimsiz kullanıcı"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">
              Portal hesabı eşleştirmesi yönetici tarafından yapılır.
            </p>
          )}
          <div className="border-t border-border pt-4 sm:col-span-2">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <FileText className="h-4 w-4 text-highlight" /> Fatura Bilgileri
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Fatura Ünvanı
                <Input
                  value={billingTitle}
                  onChange={(event) => setBillingTitle(event.target.value)}
                  maxLength={180}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Vergi Dairesi
                <Input
                  value={taxOffice}
                  onChange={(event) => setTaxOffice(event.target.value)}
                  maxLength={120}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Vergi Numarası
                <Input
                  value={taxNo}
                  onChange={(event) => setTaxNo(event.target.value)}
                  maxLength={32}
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Fatura Adresi
                <Input
                  value={billingAddress}
                  onChange={(event) => setBillingAddress(event.target.value)}
                  maxLength={1000}
                />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => saveCustomer.mutate()}
            disabled={!name.trim() || saveCustomer.isPending}
          >
            {saveCustomer.isPending
              ? "Kaydediliyor..."
              : editingCustomer
                ? "Değişiklikleri Kaydet"
                : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <PageHeader
        title="Müşteriler"
        description="İş emirlerinin bağlı olduğu müşteri ve portal hesapları."
        actions={createButton}
      />
      {customers.length === 0 ? (
        <EmptyState
          title="Henüz müşteri yok"
          description="İlk görevi oluşturabilmek için önce müşteri kaydı ekleyin."
          action={createButton}
        />
      ) : (
        <section className="surface-panel overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-black">Müşteri Kayıtları</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              İletişim, portal ve fatura bilgilerini bu bölümden yönetin.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firma</TableHead>
                <TableHead>İletişim</TableHead>
                <TableHead>Fatura Bilgisi</TableHead>
                <TableHead>Portal Hesabı</TableHead>
                <TableHead className="text-right">İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-bold">{customer.name}</TableCell>
                  <TableCell>{customer.contact || "—"}</TableCell>
                  <TableCell>
                    {customer.billing_title ||
                    customer.tax_no ||
                    customer.billing_address ? (
                      <div className="max-w-56 space-y-0.5 text-sm">
                        <p className="font-semibold">
                          {customer.billing_title || "Fatura ünvanı girilmedi"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[customer.tax_office, customer.tax_no]
                            .filter(Boolean)
                            .join(" · ") || "Vergi bilgisi girilmedi"}
                        </p>
                        {customer.billing_address ? (
                          <p
                            className="truncate text-xs text-muted-foreground"
                            title={customer.billing_address}
                          >
                            {customer.billing_address}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    {customer.contact_user_id
                      ? profileById.get(customer.contact_user_id)?.full_name ||
                        "Bağlı kullanıcı"
                      : "Eşleştirilmedi"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {role === "admin" && !customer.contact_user_id ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setAccountTarget({
                              id: customer.id,
                              name: customer.name,
                            });
                            setAccountForm(emptyAccountForm);
                            setShowAccountPassword(false);
                          }}
                        >
                          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Portal
                          Hesabı Aç
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => beginEdit(customer)}
                      >
                        <Pencil className="mr-1.5 h-3.5 w-3.5" /> Düzenle
                      </Button>
                      {role === "admin" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteCustomer.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `${customer.name} müşterisini silmek istediğinize emin misiniz?`,
                              )
                            ) {
                              deleteCustomer.mutate(customer.id);
                            }
                          }}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Sil
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
      <Dialog
        open={Boolean(accountTarget)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !createCustomerAccount.isPending) {
            setAccountTarget(null);
            setAccountForm(emptyAccountForm);
            setShowAccountPassword(false);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Müşteri portal hesabı aç</DialogTitle>
            <DialogDescription>
              Bu hesap doğrudan {accountTarget?.name ?? "seçilen firma"} ile
              eşleştirilir. Müşteri kullanıcı adı veya e-posta ve geçici
              şifresiyle giriş yapabilir.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">
              <span>
                Yetkili Ad Soyad <span className="text-destructive">*</span>
              </span>
              <Input
                value={accountForm.fullName}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
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
                Telefon
                <Input
                  value={accountForm.phone}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      phone: event.target.value,
                    })
                  }
                  maxLength={40}
                  autoComplete="tel"
                  placeholder="+90 5xx xxx xx xx"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                E-posta
                <span className="sr-only"> (isteğe bağlı)</span>
                <Input
                  type="email"
                  value={accountForm.email}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      email: event.target.value,
                    })
                  }
                  maxLength={254}
                  autoComplete="email"
                  placeholder="yetkili@firma.com (isteğe bağlı)"
                />
              </label>
            </div>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>
                Kullanıcı Adı <span className="text-destructive">*</span>
              </span>
              <Input
                value={accountForm.username}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    username: event.target.value.toLowerCase(),
                  })
                }
                maxLength={32}
                autoComplete="username"
                placeholder="ornek: ahmet.yilmaz"
              />
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                3-32 karakter; küçük harf, rakam, nokta, tire ve alt çizgi.
              </span>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">
              <span>
                Geçici Şifre <span className="text-destructive">*</span>
              </span>
              <div className="relative">
                <Input
                  type={showAccountPassword ? "text" : "password"}
                  value={accountForm.temporaryPassword}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
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
                  onClick={() => setShowAccountPassword((value) => !value)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-highlight"
                  aria-label={
                    showAccountPassword ? "Şifreyi gizle" : "Şifreyi göster"
                  }
                >
                  {showAccountPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <span className="text-xs font-normal leading-5 text-muted-foreground">
                En az 12 karakter; büyük/küçük harf, rakam ve özel karakter.
                Şifre sistem kayıtlarına yazılmaz.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAccountTarget(null)}
              disabled={createCustomerAccount.isPending}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              onClick={() => createCustomerAccount.mutate()}
              disabled={!accountFormIsValid || createCustomerAccount.isPending}
            >
              {createCustomerAccount.isPending
                ? "Hesap Açılıyor..."
                : "Hesabı Oluştur ve Bağla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {customersQuery.error ? (
        <p className="mt-4 text-sm text-destructive">
          {errorMessage(customersQuery.error)}
        </p>
      ) : null}
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-4 w-4" /> Müşteri yalnızca kendisine açılmış iş ve
        fotoğrafları görür.
      </div>
    </>
  );
}
