import React, { useEffect, useState } from 'react';

// Controlled numeric input that lets the user CLEAR the field. The stock
// pattern `value={n}` + `onChange={e => setN(Number(e.target.value) || 0)}`
// re-renders "0" the moment the user hits Delete on a zero-valued field, so
// the field appears un-editable. This component stores a local string draft,
// only propagates numbers to the parent, and lets empty string exist as
// transient state.
//
// Nullable variant: pass `nullable` to allow the field to represent "unset"
// distinct from zero. `value` becomes `number | null`; empty commits as null
// (or whatever `emptyAs` is set to when explicit).

interface NumberInputPropsBase
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  /** Allow decimals. Default true. */
  allowDecimal?: boolean;
}

interface NumberInputProps extends NumberInputPropsBase {
  value: number;
  onChange: (n: number) => void;
  /** Committed value if user leaves the field empty. Default 0. */
  emptyAs?: number;
  nullable?: false;
}

interface NullableNumberInputProps extends NumberInputPropsBase {
  value: number | null;
  onChange: (n: number | null) => void;
  /** Committed value if user leaves the field empty. Default null. */
  emptyAs?: number | null;
  nullable: true;
}

type Props = NumberInputProps | NullableNumberInputProps;

function serialise(v: number | null): string {
  if (v === null || v === undefined) return '';
  if (v === 0) return '';
  return String(v);
}

// Internal implementation props — all fields explicitly typed.
// This avoids spreading a discriminated union (which TypeScript forbids).
interface NumberInputImpl extends NumberInputPropsBase {
  value: number | null;
  onChange: (n: number | null) => void;
  nullable: boolean;
  emptyAs: number | null;
}

function NumberInputImpl({
  value, onChange, allowDecimal = true, onBlur, onFocus, nullable, emptyAs, ...rest
}: NumberInputImpl) {
  const [draft, setDraft] = useState<string>(serialise(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setDraft(serialise(value));
  }, [value, focused]);

  const commitEmpty = () => { onChange(emptyAs); };

  return (
    <input
      {...rest}
      type="text"
      inputMode={allowDecimal ? 'decimal' : 'numeric'}
      value={draft}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onChange={e => {
        const raw = e.target.value;
        const pattern = allowDecimal ? /^-?\d*\.?\d*$/ : /^-?\d*$/;
        if (raw !== '' && !pattern.test(raw)) return;
        setDraft(raw);
        if (raw === '' || raw === '-' || raw === '.' || raw === '-.') {
          commitEmpty();
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
      onBlur={e => {
        setFocused(false);
        if (draft === '' || draft === '-' || draft === '.' || draft === '-.') {
          setDraft(emptyAs === 0 || emptyAs === null || emptyAs === undefined ? '' : String(emptyAs));
          commitEmpty();
        } else {
          const n = Number(draft);
          if (Number.isFinite(n)) {
            setDraft(n === 0 ? '' : String(n));
            onChange(n);
          }
        }
        onBlur?.(e);
      }}
    />
  );
}

export function NumberInput(props: Props) {
  if (props.nullable) {
    const { value, onChange, nullable: _n, emptyAs = null, ...rest } = props;
    return <NumberInputImpl value={value} onChange={onChange} nullable emptyAs={emptyAs} {...rest} />;
  }
  const { value, onChange, nullable: _n, emptyAs = 0, ...rest } = props as NumberInputProps;
  return <NumberInputImpl value={value} onChange={onChange as (n: number | null) => void} nullable={false} emptyAs={emptyAs} {...rest} />;
}
