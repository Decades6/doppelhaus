export interface Position {
  id: string;
  position_nr: string | null;
  gewerk: string;
  beschreibung: string;
  menge: number | null;
  einheit: string | null;
  einzelpreis: number | null;
  gesamtpreis: number;
  eigenleistung: boolean;
  created_at: string;
}

export interface ParsedPosition {
  position_nr?: string;
  gewerk: string;
  beschreibung: string;
  menge?: number;
  einheit?: string;
  einzelpreis?: number;
  gesamtpreis: number;
}
