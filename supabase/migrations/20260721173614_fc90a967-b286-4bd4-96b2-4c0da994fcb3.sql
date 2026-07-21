
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'contractor', 'customer');
CREATE TYPE public.stock_unit AS ENUM ('adet', 'metre');
CREATE TYPE public.work_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact TEXT,
  contact_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  approved_progress_pct INT NOT NULL DEFAULT 0 CHECK (approved_progress_pct BETWEEN 0 AND 100),
  status public.work_status NOT NULL DEFAULT 'planned',
  show_to_customer BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_at_half_hour CHECK (
    EXTRACT(MINUTE FROM scheduled_at) IN (0, 30)
    AND EXTRACT(SECOND FROM scheduled_at) = 0
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.work_order_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, contractor_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_assignments TO authenticated;
GRANT ALL ON public.work_order_assignments TO service_role;
ALTER TABLE public.work_order_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.progress_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pct INT NOT NULL CHECK (pct BETWEEN 0 AND 100),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.progress_updates TO authenticated;
GRANT ALL ON public.progress_updates TO service_role;
ALTER TABLE public.progress_updates ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id),
  storage_path TEXT NOT NULL,
  caption TEXT,
  show_to_customer BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.photos TO authenticated;
GRANT ALL ON public.photos TO service_role;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.stock_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  unit public.stock_unit NOT NULL DEFAULT 'adet',
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_items TO authenticated;
GRANT ALL ON public.stock_items TO service_role;
ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_item_id UUID NOT NULL REFERENCES public.stock_items(id) ON DELETE CASCADE,
  work_order_id UUID REFERENCES public.work_orders(id) ON DELETE SET NULL,
  contractor_id UUID REFERENCES auth.users(id),
  quantity NUMERIC(14,3) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.stock_items SET quantity = quantity - NEW.quantity WHERE id = NEW.stock_item_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

CREATE TABLE public.progress_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  approved_pct INT NOT NULL CHECK (approved_pct BETWEEN 0 AND 100),
  approved_amount NUMERIC(14,2) NOT NULL,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.progress_approvals TO authenticated;
GRANT ALL ON public.progress_approvals TO service_role;
ALTER TABLE public.progress_approvals ENABLE ROW LEVEL SECURITY;

-- ================= RLS =================
CREATE POLICY "profiles_authenticated_read" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "roles_self_read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "customers_admin_all" ON public.customers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "customers_self_read" ON public.customers FOR SELECT TO authenticated
  USING (contact_user_id = auth.uid());
CREATE POLICY "customers_contractor_read" ON public.customers FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'contractor')
    AND EXISTS (
      SELECT 1 FROM public.work_orders wo
      JOIN public.work_order_assignments woa ON woa.work_order_id = wo.id
      WHERE wo.customer_id = customers.id AND woa.contractor_id = auth.uid()
    )
  );

CREATE POLICY "wo_admin_all" ON public.work_orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "wo_contractor_read" ON public.work_orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_order_assignments woa
                 WHERE woa.work_order_id = work_orders.id AND woa.contractor_id = auth.uid()));
CREATE POLICY "wo_contractor_update" ON public.work_orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_order_assignments woa
                 WHERE woa.work_order_id = work_orders.id AND woa.contractor_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.work_order_assignments woa
                      WHERE woa.work_order_id = work_orders.id AND woa.contractor_id = auth.uid()));
CREATE POLICY "wo_customer_read" ON public.work_orders FOR SELECT TO authenticated
  USING (
    show_to_customer = true
    AND EXISTS (SELECT 1 FROM public.customers c
                WHERE c.id = work_orders.customer_id AND c.contact_user_id = auth.uid())
  );

CREATE POLICY "woa_admin_all" ON public.work_order_assignments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "woa_contractor_self_read" ON public.work_order_assignments FOR SELECT TO authenticated
  USING (contractor_id = auth.uid());

CREATE POLICY "pu_admin_all" ON public.progress_updates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "pu_contractor_insert" ON public.progress_updates FOR INSERT TO authenticated
  WITH CHECK (
    contractor_id = auth.uid() AND
    EXISTS (SELECT 1 FROM public.work_order_assignments woa
            WHERE woa.work_order_id = progress_updates.work_order_id AND woa.contractor_id = auth.uid())
  );
CREATE POLICY "pu_contractor_read" ON public.progress_updates FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_order_assignments woa
                 WHERE woa.work_order_id = progress_updates.work_order_id AND woa.contractor_id = auth.uid()));

CREATE POLICY "photos_admin_all" ON public.photos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "photos_contractor_write" ON public.photos FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (SELECT 1 FROM public.work_order_assignments woa
            WHERE woa.work_order_id = photos.work_order_id AND woa.contractor_id = auth.uid())
  );
CREATE POLICY "photos_contractor_read" ON public.photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.work_order_assignments woa
                 WHERE woa.work_order_id = photos.work_order_id AND woa.contractor_id = auth.uid()));
CREATE POLICY "photos_customer_read" ON public.photos FOR SELECT TO authenticated
  USING (
    show_to_customer = true
    AND EXISTS (SELECT 1 FROM public.work_orders wo
                JOIN public.customers c ON c.id = wo.customer_id
                WHERE wo.id = photos.work_order_id
                  AND wo.show_to_customer = true
                  AND c.contact_user_id = auth.uid())
  );

CREATE POLICY "stock_admin_all" ON public.stock_items FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "stock_contractor_read" ON public.stock_items FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'contractor'));

CREATE POLICY "sm_admin_all" ON public.stock_movements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "sm_contractor_insert" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (
    contractor_id = auth.uid() AND (
      work_order_id IS NULL OR EXISTS (
        SELECT 1 FROM public.work_order_assignments woa
        WHERE woa.work_order_id = stock_movements.work_order_id AND woa.contractor_id = auth.uid()
      )
    )
  );
CREATE POLICY "sm_contractor_read" ON public.stock_movements FOR SELECT TO authenticated
  USING (contractor_id = auth.uid());

CREATE POLICY "pa_admin_all" ON public.progress_approvals FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- storage.objects policies
CREATE POLICY "wp_admin_all" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'work-photos' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'work-photos' AND public.has_role(auth.uid(), 'admin'));
CREATE POLICY "wp_contractor_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'work-photos'
    AND public.has_role(auth.uid(), 'contractor')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "wp_contractor_read_own" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'work-photos'
    AND public.has_role(auth.uid(), 'contractor')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "wp_customer_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'work-photos'
    AND EXISTS (
      SELECT 1 FROM public.photos p
      JOIN public.work_orders wo ON wo.id = p.work_order_id
      JOIN public.customers c ON c.id = wo.customer_id
      WHERE p.storage_path = storage.objects.name
        AND p.show_to_customer = true
        AND wo.show_to_customer = true
        AND c.contact_user_id = auth.uid()
    )
  );
