//! DocSpecialCare smart contract.
//!
//! One patient journey, enforced on-chain:
//!
//!   book physician (fee escrowed) -> physician completes (fee released)
//!     -> physician refers to specialist -> patient books specialist with referral
//!     -> specialist orders lab test -> patient pays lab (escrowed)
//!     -> lab submits result hash (fee released, access granted)
//!     -> specialist issues prescription -> patient assigns pharmacy
//!     -> pharmacy quotes -> patient pays (escrowed) -> pharmacy dispenses once (released)
//!
//! Privacy rule: no plaintext medical data is stored here. Clinical content
//! (notes, lab results, prescription details) lives off-chain, encrypted in the
//! browser. The contract stores only content hashes and the access list that
//! says who may receive a decryption key.

use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// How long after a slot starts a patient must wait before reclaiming an
/// uncompleted consultation fee (provider no-show protection).
pub const NO_SHOW_GRACE_MS: u64 = 24 * 60 * 60 * 1000;
const MS_PER_DAY: u64 = 24 * 60 * 60 * 1000;
const MAX_LIST: u32 = 100;

// ---------------------------------------------------------------- types

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    Physician,
    Specialist,
    Laboratory,
    Pharmacy,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Provider {
    pub account_id: AccountId,
    pub role: Role,
    pub name: String,
    /// e.g. "Cardiology" for specialists, "Haematology" for labs; free text.
    pub specialty: String,
    pub license_id: String,
    /// Consultation fee (physician/specialist) or base test fee (lab).
    pub fee: NearToken,
    pub verified: bool,
    pub registered_at: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ConsultStatus {
    Booked,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Consultation {
    pub id: u64,
    pub patient: AccountId,
    pub provider: AccountId,
    pub provider_role: Role,
    pub fee: NearToken,
    /// Slot start, unix ms. Replaces the hospital queue.
    pub slot_start: u64,
    pub referral_id: Option<u64>,
    pub status: ConsultStatus,
    pub created_at: u64,
    pub closed_at: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Referral {
    pub id: u64,
    pub consultation_id: u64,
    pub patient: AccountId,
    pub from_provider: AccountId,
    pub to_specialist: AccountId,
    /// Off-chain record id of the encrypted referral letter (patient, referrer, specialist can read).
    pub note_record_id: String,
    pub created_at: u64,
    /// Set when the patient books the specialist with this referral.
    pub used_by_consultation: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LabStatus {
    AwaitingPayment,
    Paid,
    ResultReady,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LabOrder {
    pub id: u64,
    pub consultation_id: u64,
    pub patient: AccountId,
    pub ordered_by: AccountId,
    pub lab: AccountId,
    pub fee: NearToken,
    /// Off-chain record id of the encrypted order (which tests); patient, doctor and lab can read.
    pub order_record_id: String,
    pub status: LabStatus,
    /// Off-chain record id of the encrypted result, once uploaded.
    pub result_record_id: Option<String>,
    pub created_at: u64,
    pub completed_at: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RxStatus {
    Issued,
    Quoted,
    Paid,
    Dispensed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Prescription {
    pub id: u64,
    pub consultation_id: u64,
    pub patient: AccountId,
    pub prescriber: AccountId,
    /// Off-chain record id of the encrypted prescription details.
    pub record_id: String,
    pub details_hash: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub pharmacy: Option<AccountId>,
    pub price: Option<NearToken>,
    pub status: RxStatus,
    pub dispensed_at: Option<u64>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RecordKind {
    ConsultNote,
    ReferralLetter,
    LabOrder,
    LabResult,
    Prescription,
    PatientUpload,
}

/// Pointer to an encrypted off-chain record plus its access list.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Record {
    pub id: String,
    pub patient: AccountId,
    pub kind: RecordKind,
    pub uploaded_by: AccountId,
    /// sha-256 (hex) of the ciphertext, so anyone can check it was not altered.
    pub content_hash: String,
    pub consultation_id: Option<u64>,
    pub viewers: Vec<AccountId>,
    pub created_at: u64,
}

// ---------------------------------------------------------------- contract

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    /// When true, newly registered providers are verified immediately (testnet demo).
    auto_verify: bool,
    providers: IterableMap<AccountId, Provider>,
    /// Public x25519 key (base64) each user uses for end-to-end encryption.
    encryption_keys: LookupMap<AccountId, String>,
    consultations: LookupMap<u64, Consultation>,
    referrals: LookupMap<u64, Referral>,
    lab_orders: LookupMap<u64, LabOrder>,
    prescriptions: LookupMap<u64, Prescription>,
    records: LookupMap<String, Record>,
    /// "provider|slot" -> consultation id; prevents double booking a slot.
    booked_slots: LookupMap<String, u64>,
    idx_consult: LookupMap<AccountId, Vec<u64>>,
    idx_referral: LookupMap<AccountId, Vec<u64>>,
    idx_lab: LookupMap<AccountId, Vec<u64>>,
    idx_rx: LookupMap<AccountId, Vec<u64>>,
    idx_record: LookupMap<AccountId, Vec<String>>,
    next_consult: u64,
    next_referral: u64,
    next_lab: u64,
    next_rx: u64,
}

fn push_idx<T: near_sdk::borsh::BorshSerialize + near_sdk::borsh::BorshDeserialize>(
    map: &mut LookupMap<AccountId, Vec<T>>,
    acc: &AccountId,
    v: T,
) {
    if let Some(list) = map.get_mut(acc) {
        list.push(v);
    } else {
        map.insert(acc.clone(), vec![v]);
    }
}

fn emit(event: &str, data: String) {
    env::log_str(&format!(
        "EVENT_JSON:{{\"standard\":\"docspecialcare\",\"version\":\"1.0.0\",\"event\":\"{}\",\"data\":[{}]}}",
        event, data
    ));
}

fn pay(to: &AccountId, amount: NearToken) {
    if amount.as_yoctonear() > 0 {
        Promise::new(to.clone()).transfer(amount).detach();
    }
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId, auto_verify: bool) -> Self {
        Self {
            owner,
            auto_verify,
            providers: IterableMap::new(b"p"),
            encryption_keys: LookupMap::new(b"k"),
            consultations: LookupMap::new(b"c"),
            referrals: LookupMap::new(b"r"),
            lab_orders: LookupMap::new(b"l"),
            prescriptions: LookupMap::new(b"x"),
            records: LookupMap::new(b"d"),
            booked_slots: LookupMap::new(b"s"),
            idx_consult: LookupMap::new(b"1"),
            idx_referral: LookupMap::new(b"2"),
            idx_lab: LookupMap::new(b"3"),
            idx_rx: LookupMap::new(b"4"),
            idx_record: LookupMap::new(b"5"),
            next_consult: 1,
            next_referral: 1,
            next_lab: 1,
            next_rx: 1,
        }
    }

    // ------------------------------------------------------------ admin

    pub fn verify_provider(&mut self, account_id: AccountId, verified: bool) {
        self.assert_owner();
        let p = self.providers.get_mut(&account_id).expect("Provider not found");
        p.verified = verified;
        emit("provider_verified", format!("{{\"account_id\":\"{}\",\"verified\":{}}}", account_id, verified));
    }

    pub fn set_auto_verify(&mut self, auto_verify: bool) {
        self.assert_owner();
        self.auto_verify = auto_verify;
    }

    // ------------------------------------------------------------ identity

    /// Any user (patient or provider) publishes the public half of their
    /// browser-generated encryption key so others can share records with them.
    pub fn set_encryption_key(&mut self, public_key: String) {
        require!(public_key.len() >= 40 && public_key.len() <= 64, "Invalid key");
        self.encryption_keys.insert(env::predecessor_account_id(), public_key);
    }

    pub fn register_provider(
        &mut self,
        role: Role,
        name: String,
        specialty: String,
        license_id: String,
        fee: NearToken,
    ) {
        let acc = env::predecessor_account_id();
        require!(!name.is_empty() && name.len() <= 100, "Invalid name");
        require!(specialty.len() <= 100 && license_id.len() <= 100, "Field too long");
        let verified = self
            .providers
            .get(&acc)
            .map(|p| p.verified && p.role == role)
            .unwrap_or(false)
            || self.auto_verify;
        let provider = Provider {
            account_id: acc.clone(),
            role,
            name,
            specialty,
            license_id,
            fee,
            verified,
            registered_at: env::block_timestamp_ms(),
        };
        self.providers.insert(acc.clone(), provider);
        emit("provider_registered", format!("{{\"account_id\":\"{}\",\"role\":\"{:?}\"}}", acc, role));
    }

    // ------------------------------------------------------------ consultations

    /// Patient books a slot and pays the fee into escrow. Specialists can only
    /// be booked with a referral issued to this patient for this specialist.
    #[payable]
    pub fn book_consultation(&mut self, provider_id: AccountId, slot_start: u64, referral_id: Option<u64>) -> u64 {
        let patient = env::predecessor_account_id();
        let provider = self.providers.get(&provider_id).expect("Provider not found").clone();
        require!(provider.verified, "Provider is not verified");
        require!(
            matches!(provider.role, Role::Physician | Role::Specialist),
            "Provider does not offer consultations"
        );
        require!(patient != provider_id, "Cannot book yourself");
        require!(slot_start > env::block_timestamp_ms(), "Slot must be in the future");

        let slot_key = format!("{}|{}", provider_id, slot_start);
        require!(!self.booked_slots.contains_key(&slot_key), "Slot already booked");

        let deposit = env::attached_deposit();
        require!(deposit >= provider.fee, "Attached deposit is less than the consultation fee");

        let id = self.next_consult;
        if provider.role == Role::Specialist {
            let rid = referral_id.expect("A referral is required to book a specialist");
            let r = self.referrals.get_mut(&rid).expect("Referral not found");
            require!(r.patient == patient, "Referral is for another patient");
            require!(r.to_specialist == provider_id, "Referral is for another specialist");
            require!(r.used_by_consultation.is_none(), "Referral already used");
            r.used_by_consultation = Some(id);
        }
        self.next_consult += 1;

        let c = Consultation {
            id,
            patient: patient.clone(),
            provider: provider_id.clone(),
            provider_role: provider.role,
            fee: provider.fee,
            slot_start,
            referral_id: if provider.role == Role::Specialist { referral_id } else { None },
            status: ConsultStatus::Booked,
            created_at: env::block_timestamp_ms(),
            closed_at: None,
        };
        self.consultations.insert(id, c);
        self.booked_slots.insert(slot_key, id);
        push_idx(&mut self.idx_consult, &patient, id);
        push_idx(&mut self.idx_consult, &provider_id, id);

        // refund anything paid above the fee
        pay(&patient, deposit.saturating_sub(provider.fee));
        emit(
            "consultation_booked",
            format!("{{\"id\":{},\"patient\":\"{}\",\"provider\":\"{}\",\"fee\":\"{}\"}}", id, patient, provider_id, provider.fee.as_yoctonear()),
        );
        id
    }

    /// Provider marks the consultation done; the escrowed fee is released to them.
    pub fn complete_consultation(&mut self, consultation_id: u64) {
        let caller = env::predecessor_account_id();
        let c = self.consultations.get_mut(&consultation_id).expect("Consultation not found");
        require!(c.provider == caller, "Only the provider can complete");
        require!(c.status == ConsultStatus::Booked, "Consultation is not open");
        c.status = ConsultStatus::Completed;
        c.closed_at = Some(env::block_timestamp_ms());
        let (to, fee) = (c.provider.clone(), c.fee);
        pay(&to, fee);
        emit("consultation_completed", format!("{{\"id\":{},\"paid\":\"{}\"}}", consultation_id, fee.as_yoctonear()));
    }

    /// Refunds the patient. Allowed for: the provider at any time; the patient
    /// before the slot starts; or the patient after the no-show grace period.
    pub fn cancel_consultation(&mut self, consultation_id: u64) {
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp_ms();
        let c = self.consultations.get_mut(&consultation_id).expect("Consultation not found");
        require!(c.status == ConsultStatus::Booked, "Consultation is not open");
        let allowed = caller == c.provider
            || (caller == c.patient && (now < c.slot_start || now >= c.slot_start + NO_SHOW_GRACE_MS));
        require!(allowed, "Cannot cancel during the consultation window");
        c.status = ConsultStatus::Cancelled;
        c.closed_at = Some(now);
        let (patient, fee, slot_key, referral) =
            (c.patient.clone(), c.fee, format!("{}|{}", c.provider, c.slot_start), c.referral_id);
        self.booked_slots.remove(&slot_key);
        // give the referral back so the patient can rebook
        if let Some(rid) = referral {
            if let Some(r) = self.referrals.get_mut(&rid) {
                r.used_by_consultation = None;
            }
        }
        pay(&patient, fee);
        emit("consultation_cancelled", format!("{{\"id\":{},\"refunded\":\"{}\"}}", consultation_id, fee.as_yoctonear()));
    }

    // ------------------------------------------------------------ referrals

    /// The consulting provider refers the patient to a verified specialist.
    pub fn refer_to_specialist(
        &mut self,
        consultation_id: u64,
        specialist_id: AccountId,
        record_id: String,
        content_hash: String,
    ) -> u64 {
        let caller = env::predecessor_account_id();
        let c = self.consultations.get(&consultation_id).expect("Consultation not found").clone();
        require!(c.provider == caller, "Only the consulting provider can refer");
        require!(c.status != ConsultStatus::Cancelled, "Consultation was cancelled");
        let s = self.providers.get(&specialist_id).expect("Specialist not found");
        require!(s.role == Role::Specialist && s.verified, "Target is not a verified specialist");
        require!(specialist_id != caller, "Cannot refer to yourself");
        self.insert_record(
            record_id.clone(),
            c.patient.clone(),
            RecordKind::ReferralLetter,
            caller.clone(),
            content_hash,
            Some(consultation_id),
            vec![c.patient.clone(), caller.clone(), specialist_id.clone()],
        );

        let id = self.next_referral;
        self.next_referral += 1;
        self.referrals.insert(
            id,
            Referral {
                id,
                consultation_id,
                patient: c.patient.clone(),
                from_provider: caller.clone(),
                to_specialist: specialist_id.clone(),
                note_record_id: record_id,
                created_at: env::block_timestamp_ms(),
                used_by_consultation: None,
            },
        );
        push_idx(&mut self.idx_referral, &c.patient, id);
        push_idx(&mut self.idx_referral, &caller, id);
        push_idx(&mut self.idx_referral, &specialist_id, id);
        emit("referral_created", format!("{{\"id\":{},\"patient\":\"{}\",\"to\":\"{}\"}}", id, c.patient, specialist_id));
        id
    }

    // ------------------------------------------------------------ lab tests

    pub fn order_lab_test(
        &mut self,
        consultation_id: u64,
        lab_id: AccountId,
        record_id: String,
        content_hash: String,
    ) -> u64 {
        let caller = env::predecessor_account_id();
        let c = self.consultations.get(&consultation_id).expect("Consultation not found").clone();
        require!(c.provider == caller, "Only the consulting provider can order tests");
        require!(c.status != ConsultStatus::Cancelled, "Consultation was cancelled");
        let lab = self.providers.get(&lab_id).expect("Lab not found").clone();
        require!(lab.role == Role::Laboratory && lab.verified, "Target is not a verified laboratory");
        self.insert_record(
            record_id.clone(),
            c.patient.clone(),
            RecordKind::LabOrder,
            caller.clone(),
            content_hash,
            Some(consultation_id),
            vec![c.patient.clone(), caller.clone(), lab_id.clone()],
        );

        let id = self.next_lab;
        self.next_lab += 1;
        self.lab_orders.insert(
            id,
            LabOrder {
                id,
                consultation_id,
                patient: c.patient.clone(),
                ordered_by: caller.clone(),
                lab: lab_id.clone(),
                fee: lab.fee,
                order_record_id: record_id,
                status: LabStatus::AwaitingPayment,
                result_record_id: None,
                created_at: env::block_timestamp_ms(),
                completed_at: None,
            },
        );
        push_idx(&mut self.idx_lab, &c.patient, id);
        push_idx(&mut self.idx_lab, &caller, id);
        push_idx(&mut self.idx_lab, &lab_id, id);
        emit("lab_ordered", format!("{{\"id\":{},\"lab\":\"{}\",\"patient\":\"{}\"}}", id, lab_id, c.patient));
        id
    }

    #[payable]
    pub fn pay_lab_order(&mut self, lab_order_id: u64) {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let o = self.lab_orders.get_mut(&lab_order_id).expect("Lab order not found");
        require!(o.patient == caller, "Only the patient can pay");
        require!(o.status == LabStatus::AwaitingPayment, "Lab order already paid");
        require!(deposit >= o.fee, "Attached deposit is less than the lab fee");
        o.status = LabStatus::Paid;
        let fee = o.fee;
        pay(&caller, deposit.saturating_sub(fee));
        emit("lab_paid", format!("{{\"id\":{},\"amount\":\"{}\"}}", lab_order_id, fee.as_yoctonear()));
    }

    /// Lab registers the encrypted result. The escrowed fee is released and the
    /// patient, ordering doctor and lab are added to the record's viewers.
    pub fn submit_lab_result(&mut self, lab_order_id: u64, record_id: String, content_hash: String) {
        let caller = env::predecessor_account_id();
        let o = self.lab_orders.get(&lab_order_id).expect("Lab order not found").clone();
        require!(o.lab == caller, "Only the assigned lab can submit results");
        require!(o.status == LabStatus::Paid, "Lab order is not paid or already completed");
        self.insert_record(
            record_id.clone(),
            o.patient.clone(),
            RecordKind::LabResult,
            caller.clone(),
            content_hash,
            Some(o.consultation_id),
            vec![o.patient.clone(), o.ordered_by.clone(), caller.clone()],
        );
        let o = self.lab_orders.get_mut(&lab_order_id).unwrap();
        o.status = LabStatus::ResultReady;
        o.result_record_id = Some(record_id.clone());
        o.completed_at = Some(env::block_timestamp_ms());
        let fee = o.fee;
        pay(&caller, fee);
        emit("lab_result", format!("{{\"id\":{},\"record_id\":\"{}\"}}", lab_order_id, record_id));
    }

    // ------------------------------------------------------------ prescriptions

    pub fn issue_prescription(
        &mut self,
        consultation_id: u64,
        record_id: String,
        details_hash: String,
        valid_days: u32,
    ) -> u64 {
        let caller = env::predecessor_account_id();
        let c = self.consultations.get(&consultation_id).expect("Consultation not found").clone();
        require!(c.provider == caller, "Only the consulting provider can prescribe");
        require!(c.status != ConsultStatus::Cancelled, "Consultation was cancelled");
        require!(valid_days >= 1 && valid_days <= 365, "valid_days must be 1..365");
        self.insert_record(
            record_id.clone(),
            c.patient.clone(),
            RecordKind::Prescription,
            caller.clone(),
            details_hash.clone(),
            Some(consultation_id),
            vec![c.patient.clone(), caller.clone()],
        );
        let now = env::block_timestamp_ms();
        let id = self.next_rx;
        self.next_rx += 1;
        self.prescriptions.insert(
            id,
            Prescription {
                id,
                consultation_id,
                patient: c.patient.clone(),
                prescriber: caller.clone(),
                record_id,
                details_hash,
                issued_at: now,
                expires_at: now + valid_days as u64 * MS_PER_DAY,
                pharmacy: None,
                price: None,
                status: RxStatus::Issued,
                dispensed_at: None,
            },
        );
        push_idx(&mut self.idx_rx, &c.patient, id);
        push_idx(&mut self.idx_rx, &caller, id);
        emit("prescription_issued", format!("{{\"id\":{},\"patient\":\"{}\"}}", id, c.patient));
        id
    }

    /// Patient chooses where to collect the medication; that pharmacy gains
    /// access to the prescription record.
    pub fn assign_pharmacy(&mut self, prescription_id: u64, pharmacy_id: AccountId) {
        let caller = env::predecessor_account_id();
        let ph = self.providers.get(&pharmacy_id).expect("Pharmacy not found");
        require!(ph.role == Role::Pharmacy && ph.verified, "Target is not a verified pharmacy");
        let rx = self.prescriptions.get_mut(&prescription_id).expect("Prescription not found");
        require!(rx.patient == caller, "Only the patient can assign a pharmacy");
        require!(
            matches!(rx.status, RxStatus::Issued | RxStatus::Quoted),
            "Prescription already paid or dispensed"
        );
        require!(env::block_timestamp_ms() < rx.expires_at, "Prescription expired");
        let old = rx.pharmacy.replace(pharmacy_id.clone());
        rx.status = RxStatus::Issued;
        rx.price = None;
        let record_id = rx.record_id.clone();
        if let Some(old) = old {
            self.remove_viewer(&record_id, &old);
        }
        self.add_viewer(&record_id, &pharmacy_id);
        push_idx(&mut self.idx_rx, &pharmacy_id, prescription_id);
        emit("pharmacy_assigned", format!("{{\"id\":{},\"pharmacy\":\"{}\"}}", prescription_id, pharmacy_id));
    }

    pub fn quote_prescription(&mut self, prescription_id: u64, price: NearToken) {
        let caller = env::predecessor_account_id();
        let rx = self.prescriptions.get_mut(&prescription_id).expect("Prescription not found");
        require!(rx.pharmacy.as_ref() == Some(&caller), "Only the assigned pharmacy can quote");
        require!(matches!(rx.status, RxStatus::Issued | RxStatus::Quoted), "Cannot quote now");
        rx.price = Some(price);
        rx.status = RxStatus::Quoted;
        emit("prescription_quoted", format!("{{\"id\":{},\"price\":\"{}\"}}", prescription_id, price.as_yoctonear()));
    }

    #[payable]
    pub fn pay_prescription(&mut self, prescription_id: u64) {
        let caller = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        let rx = self.prescriptions.get_mut(&prescription_id).expect("Prescription not found");
        require!(rx.patient == caller, "Only the patient can pay");
        require!(rx.status == RxStatus::Quoted, "Prescription has no open quote");
        require!(env::block_timestamp_ms() < rx.expires_at, "Prescription expired");
        let price = rx.price.unwrap();
        require!(deposit >= price, "Attached deposit is less than the price");
        rx.status = RxStatus::Paid;
        pay(&caller, deposit.saturating_sub(price));
        emit("prescription_paid", format!("{{\"id\":{},\"amount\":\"{}\"}}", prescription_id, price.as_yoctonear()));
    }

    /// Pharmacy hands over the medication. Can happen exactly once; payment is released.
    pub fn dispense_prescription(&mut self, prescription_id: u64) {
        let caller = env::predecessor_account_id();
        let rx = self.prescriptions.get_mut(&prescription_id).expect("Prescription not found");
        require!(rx.pharmacy.as_ref() == Some(&caller), "Only the assigned pharmacy can dispense");
        require!(rx.status != RxStatus::Dispensed, "Prescription already dispensed");
        require!(rx.status == RxStatus::Paid, "Prescription is not paid");
        rx.status = RxStatus::Dispensed;
        rx.dispensed_at = Some(env::block_timestamp_ms());
        let price = rx.price.unwrap();
        pay(&caller, price);
        emit("prescription_dispensed", format!("{{\"id\":{},\"pharmacy\":\"{}\"}}", prescription_id, caller));
    }

    // ------------------------------------------------------------ records & access

    /// Patient uploads their own record, or a provider attaches a note to a
    /// consultation they ran.
    pub fn add_record(
        &mut self,
        record_id: String,
        patient: AccountId,
        kind: RecordKind,
        content_hash: String,
        consultation_id: Option<u64>,
    ) {
        let caller = env::predecessor_account_id();
        let mut viewers = vec![patient.clone()];
        if caller != patient {
            let cid = consultation_id.expect("Providers must attach records to a consultation");
            let c = self.consultations.get(&cid).expect("Consultation not found");
            require!(c.provider == caller && c.patient == patient, "Not your consultation");
            viewers.push(caller.clone());
        }
        require!(
            matches!(kind, RecordKind::ConsultNote | RecordKind::PatientUpload),
            "Use the dedicated method for this record kind"
        );
        self.insert_record(record_id, patient, kind, caller, content_hash, consultation_id, viewers);
    }

    /// Patient shares a record with someone (e.g. lab result -> specialist).
    pub fn grant_access(&mut self, record_id: String, account_id: AccountId) {
        let r = self.records.get(&record_id).expect("Record not found");
        require!(r.patient == env::predecessor_account_id(), "Only the patient can grant access");
        self.add_viewer(&record_id, &account_id);
        emit("access_granted", format!("{{\"record_id\":\"{}\",\"account_id\":\"{}\"}}", record_id, account_id));
    }

    pub fn revoke_access(&mut self, record_id: String, account_id: AccountId) {
        let r = self.records.get(&record_id).expect("Record not found");
        require!(r.patient == env::predecessor_account_id(), "Only the patient can revoke access");
        require!(account_id != r.patient, "Cannot revoke the patient");
        self.remove_viewer(&record_id, &account_id);
        emit("access_revoked", format!("{{\"record_id\":\"{}\",\"account_id\":\"{}\"}}", record_id, account_id));
    }

    // ------------------------------------------------------------ views

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    pub fn get_provider(&self, account_id: AccountId) -> Option<Provider> {
        self.providers.get(&account_id).cloned()
    }

    pub fn list_providers(&self, role: Option<Role>, verified_only: Option<bool>, from_index: Option<u32>, limit: Option<u32>) -> Vec<Provider> {
        let verified_only = verified_only.unwrap_or(true);
        self.providers
            .values()
            .filter(|p| role.map_or(true, |r| p.role == r) && (!verified_only || p.verified))
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(MAX_LIST) as usize)
            .cloned()
            .collect()
    }

    pub fn get_encryption_key(&self, account_id: AccountId) -> Option<String> {
        self.encryption_keys.get(&account_id).cloned()
    }

    pub fn get_consultation(&self, id: u64) -> Option<Consultation> {
        self.consultations.get(&id).cloned()
    }

    pub fn get_referral(&self, id: u64) -> Option<Referral> {
        self.referrals.get(&id).cloned()
    }

    pub fn get_lab_order(&self, id: u64) -> Option<LabOrder> {
        self.lab_orders.get(&id).cloned()
    }

    pub fn get_prescription(&self, id: u64) -> Option<Prescription> {
        self.prescriptions.get(&id).cloned()
    }

    pub fn get_record(&self, record_id: String) -> Option<Record> {
        self.records.get(&record_id).cloned()
    }

    pub fn can_access(&self, record_id: String, account_id: AccountId) -> bool {
        self.records.get(&record_id).map_or(false, |r| r.viewers.contains(&account_id))
    }

    /// Booked slot start times for a provider, so the UI can grey them out.
    pub fn is_slot_booked(&self, provider_id: AccountId, slot_start: u64) -> bool {
        self.booked_slots.contains_key(&format!("{}|{}", provider_id, slot_start))
    }

    /// All open (booked) slot start times for a provider, in one call.
    pub fn booked_slots(&self, provider_id: AccountId) -> Vec<u64> {
        self.idx_consult
            .get(&provider_id)
            .map(|ids| {
                ids.iter()
                    .filter_map(|i| self.consultations.get(i))
                    .filter(|c| c.provider == provider_id && c.status == ConsultStatus::Booked)
                    .map(|c| c.slot_start)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn consultations_for(&self, account_id: AccountId) -> Vec<Consultation> {
        self.idx_consult
            .get(&account_id)
            .map(|ids| ids.iter().rev().take(MAX_LIST as usize).filter_map(|i| self.consultations.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn referrals_for(&self, account_id: AccountId) -> Vec<Referral> {
        self.idx_referral
            .get(&account_id)
            .map(|ids| ids.iter().rev().take(MAX_LIST as usize).filter_map(|i| self.referrals.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn lab_orders_for(&self, account_id: AccountId) -> Vec<LabOrder> {
        self.idx_lab
            .get(&account_id)
            .map(|ids| ids.iter().rev().take(MAX_LIST as usize).filter_map(|i| self.lab_orders.get(i).cloned()).collect())
            .unwrap_or_default()
    }

    pub fn prescriptions_for(&self, account_id: AccountId) -> Vec<Prescription> {
        let mut seen = std::collections::HashSet::new();
        self.idx_rx
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .rev()
                    .filter(|i| seen.insert(**i))
                    .take(MAX_LIST as usize)
                    .filter_map(|i| self.prescriptions.get(i).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Records the account can view (as patient or as a granted viewer).
    pub fn records_for(&self, account_id: AccountId) -> Vec<Record> {
        let mut seen = std::collections::HashSet::new();
        self.idx_record
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .rev()
                    .filter(|i| seen.insert((*i).clone()))
                    .filter_map(|i| self.records.get(i))
                    .filter(|r| r.viewers.contains(&account_id))
                    .take(MAX_LIST as usize)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    }

    // ------------------------------------------------------------ internal

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "Owner only");
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_record(
        &mut self,
        id: String,
        patient: AccountId,
        kind: RecordKind,
        uploaded_by: AccountId,
        content_hash: String,
        consultation_id: Option<u64>,
        mut viewers: Vec<AccountId>,
    ) {
        require!(!id.is_empty() && id.len() <= 80, "Invalid record id");
        require!(content_hash.len() == 64, "content_hash must be sha-256 hex");
        require!(!self.records.contains_key(&id), "Record id already exists");
        let mut uniq: Vec<AccountId> = Vec::new();
        for v in viewers.drain(..) {
            if !uniq.contains(&v) {
                uniq.push(v);
            }
        }
        for v in uniq.iter() {
            push_idx(&mut self.idx_record, v, id.clone());
        }
        self.records.insert(
            id.clone(),
            Record {
                id: id.clone(),
                patient,
                kind,
                uploaded_by,
                content_hash,
                consultation_id,
                viewers: uniq,
                created_at: env::block_timestamp_ms(),
            },
        );
        emit("record_added", format!("{{\"record_id\":\"{}\",\"kind\":\"{:?}\"}}", id, kind));
    }

    fn add_viewer(&mut self, record_id: &String, acc: &AccountId) {
        let r = self.records.get_mut(record_id).expect("Record not found");
        if !r.viewers.contains(acc) {
            r.viewers.push(acc.clone());
            push_idx(&mut self.idx_record, acc, record_id.clone());
        }
    }

    fn remove_viewer(&mut self, record_id: &String, acc: &AccountId) {
        if let Some(r) = self.records.get_mut(record_id) {
            r.viewers.retain(|v| v != acc);
        }
    }
}

#[cfg(test)]
mod tests;
