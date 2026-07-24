import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { errorMessage } from "@/lib/domain";
import { AccessDenied, EmptyState, LoadingState, PageHeader } from "@/components/page-states";
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

function CustomersPage() {
  const { role, user } = useAuth();
  const canManageCustomers = role === "admin" || role === "technical_office";
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [contactUserId, setContactUserId] = useState<string>("none");
  const [billingTitle, setBillingTitle] = useState("");
  const [taxOffice, setTaxOffice] = useState("");
  const [taxNo, setTaxNo] = useState("");
  const [billingAddress, setBillingAddress] = useState("");

  const customersQuery = useQuery({
    queryKey: ["customers"],
    enabled: canManageCustomers,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").order("name");
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

  const createCustomer = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("customers").insert({
        name: name.trim(),
        contact: contact.trim() || null,
        contact_user_id: role === "admin" && contactUserId !== "none" ? contactUserId : null,
        billing_title: billingTitle.trim() || null,
        tax_office: taxOffice.trim() || null,
        tax_no: taxNo.trim() || null,
        billing_address: billingAddress.trim() || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      setName("");
      setContact("");
      setContactUserId("none");
      setBillingTitle("");
      setTaxOffice("");
      setTaxNo("");
      setBillingAddress("");
      setOpen(false);
      toast.success("Müşteri kaydedildi");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!canManageCustomers) return <AccessDenied />;
  if (customersQuery.isLoading) return <LoadingState />;

  const customers = customersQuery.data ?? [];
  const customerUsers = customerUsersQuery.data ?? [];
  const profileById = new Map(customerUsers.map((profile) => [profile.id, profile]));

  const createButton = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-12 font-bold">
          <Plus className="mr-2 h-4 w-4" /> Yeni Müşteri
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Yeni müşteri oluştur</DialogTitle>
          <DialogDescription>
            Müşteri hesabı varsa eşleştirin; yoksa daha sonra Ekip ekranından bağlayabilirsiniz.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Müşteri / Firma Adı
            <Input value={name} onChange={(event) => setName(event.target.value)} />
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
                  {customerUsers.map((profile) => (
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
            <p className="mb-3 flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4 text-primary" /> Fatura Bilgileri</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                Fatura Ünvanı
                <Input value={billingTitle} onChange={(event) => setBillingTitle(event.target.value)} maxLength={180} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Vergi Dairesi
                <Input value={taxOffice} onChange={(event) => setTaxOffice(event.target.value)} maxLength={120} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                Vergi Numarası
                <Input value={taxNo} onChange={(event) => setTaxNo(event.target.value)} maxLength={32} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium sm:col-span-2">
                Fatura Adresi
                <Input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} maxLength={1000} />
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => createCustomer.mutate()}
            disabled={!name.trim() || createCustomer.isPending}
          >
            {createCustomer.isPending ? "Kaydediliyor..." : "Kaydet"}
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
        <div className="surface-panel overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Firma</TableHead>
                <TableHead>İletişim</TableHead>
                <TableHead>Fatura Bilgisi</TableHead>
                <TableHead>Portal Hesabı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-bold">{customer.name}</TableCell>
                  <TableCell>{customer.contact || "—"}</TableCell>
                  <TableCell>
                    {customer.billing_title || customer.tax_no ? (
                      <div className="space-y-0.5 text-sm">
                        <p className="font-semibold">{customer.billing_title || "Fatura ünvanı girilmedi"}</p>
                        <p className="text-xs text-muted-foreground">
                          {[customer.tax_office, customer.tax_no].filter(Boolean).join(" · ") || "Vergi bilgisi girilmedi"}
                        </p>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {customer.contact_user_id
                      ? profileById.get(customer.contact_user_id)?.full_name || "Bağlı kullanıcı"
                      : "Eşleştirilmedi"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {customersQuery.error ? (
        <p className="mt-4 text-sm text-destructive">{errorMessage(customersQuery.error)}</p>
      ) : null}
      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-4 w-4" /> Müşteri yalnızca kendisine açılmış iş ve fotoğrafları görür.
      </div>
    </>
  );
}
