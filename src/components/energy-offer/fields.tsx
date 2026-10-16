// Enerji teklifi düzenleyicisinde ortak kullanılan form alanları.
import { useEffect, useState } from "react";
import { parseDecimal } from "@/lib/energy-offer";
import { Input } from "@/components/ui/input";
import { fmtNum } from "@/components/energy-offer/format";

/** Ondalık virgülle yazmaya izin veren sayı alanı. */
export function NumField({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(value ? fmtNum(value, 4) : "");
  useEffect(() => {
    if (parseDecimal(text) !== value) setText(value ? fmtNum(value, 4) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseDecimal(event.target.value));
      }}
    />
  );
}

export function Field({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium ${className ?? ""}`}>
      {label}
      {children}
      {hint ? (
        <span className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
