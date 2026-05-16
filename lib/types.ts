export interface Version {
  id: string;
  name: string;
  erstellt_am: string;
  nettosumme: number | null;
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
  nicht_im_angebot: boolean;
  created_at: string;
}

export interface EigenleistungMaterial {
  id: string;
  user_id: string;
  gewerk: string;
  bezeichnung: string;
  menge: number | null;
  einheit: string | null;
  einzelpreis: number | null;
  gesamtpreis: number;
  created_at: string;
}

export interface Termin {
  id: string;
  user_id: string;
  titel: string;
  datum: string;
  uhrzeit_von: string | null;
  uhrzeit_bis: string | null;
  beschreibung: string | null;
  ort: string | null;
  created_at: string;
}

export interface Zahlung {
  id: string;
  user_id: string;
  datum: string;
  betrag: number;
  beschreibung: string;
  kategorie: string | null;
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
