export type Role = "Physician" | "Specialist" | "Laboratory" | "Pharmacy";

export type Provider = {
  account_id: string;
  role: Role;
  name: string;
  specialty: string;
  license_id: string;
  fee: string;
  verified: boolean;
  registered_at: number;
};

export type Consultation = {
  id: number;
  patient: string;
  provider: string;
  provider_role: Role;
  fee: string;
  slot_start: number;
  referral_id: number | null;
  status: "Booked" | "Completed" | "Cancelled";
  created_at: number;
  closed_at: number | null;
};

export type Referral = {
  id: number;
  consultation_id: number;
  patient: string;
  from_provider: string;
  to_specialist: string;
  note_record_id: string;
  created_at: number;
  used_by_consultation: number | null;
};

export type LabOrder = {
  id: number;
  consultation_id: number;
  patient: string;
  ordered_by: string;
  lab: string;
  fee: string;
  order_record_id: string;
  status: "AwaitingPayment" | "Paid" | "ResultReady";
  result_record_id: string | null;
  created_at: number;
  completed_at: number | null;
};

export type Prescription = {
  id: number;
  consultation_id: number;
  patient: string;
  prescriber: string;
  record_id: string;
  details_hash: string;
  issued_at: number;
  expires_at: number;
  pharmacy: string | null;
  price: string | null;
  status: "Issued" | "Quoted" | "Paid" | "Dispensed";
  dispensed_at: number | null;
};

export type RecordKind =
  | "ConsultNote"
  | "ReferralLetter"
  | "LabOrder"
  | "LabResult"
  | "Prescription"
  | "PatientUpload";

export type ChainRecord = {
  id: string;
  patient: string;
  kind: RecordKind;
  uploaded_by: string;
  content_hash: string;
  consultation_id: number | null;
  viewers: string[];
  created_at: number;
};

/** Plaintext shape inside every encrypted record. */
export type RecordBody = {
  title: string;
  text?: string;
  tests?: string[];
  medications?: { name: string; dose: string; frequency: string; days: string }[];
  attachment?: { name: string; mime: string; dataB64: string };
};
