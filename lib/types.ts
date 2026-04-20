export interface Version {
  id: string;
  name: string;
  erstellt_am: string;
}

export interface Position {
  id: string;
  version_id: string | null;
  position_nr: string | null;
  gewerk: string;
  beschreibung: string;
  menge: number | null;
  einheit: string | null;
  einzelpreis: number | null;
  gesamtpreis: number;
  eigenleistung: boolean;
  eventual: boolean;
  alternativ: boolean;
  optional_aktiv: boolean;
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
  eventual?: boolean;
  alternativ?: boolean;
}
