use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;

const H: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOW_MS: u64 = 1_700_000_000_000;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(caller: &str, deposit: NearToken, now_ms: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(acc(caller))
        .attached_deposit(deposit)
        .block_timestamp(now_ms * 1_000_000)
        .build());
}

fn near(n: u128) -> NearToken {
    NearToken::from_near(n)
}

/// Contract with one verified provider of each role.
fn setup() -> Contract {
    ctx("owner.near", NearToken::from_yoctonear(0), NOW_MS);
    let mut c = Contract::new(acc("owner.near"), false);
    for (who, role, fee) in [
        ("gp.near", Role::Physician, 1),
        ("cardio.near", Role::Specialist, 3),
        ("lab.near", Role::Laboratory, 2),
        ("pharm.near", Role::Pharmacy, 0),
    ] {
        ctx(who, NearToken::from_yoctonear(0), NOW_MS);
        c.register_provider(role, who.into(), "General".into(), "LIC-1".into(), near(fee));
        ctx("owner.near", NearToken::from_yoctonear(0), NOW_MS);
        c.verify_provider(acc(who), true);
    }
    c
}

const SLOT: u64 = NOW_MS + 3_600_000;

#[test]
fn full_patient_journey() {
    let mut c = setup();

    // 1. patient books the physician, fee held in escrow
    ctx("pat.near", near(1), NOW_MS);
    let gp_visit = c.book_consultation(acc("gp.near"), SLOT, None);
    assert_eq!(c.get_consultation(gp_visit).unwrap().status, ConsultStatus::Booked);

    // 2. physician completes and refers to the cardiologist
    ctx("gp.near", NearToken::from_yoctonear(0), SLOT);
    c.complete_consultation(gp_visit);
    let referral = c.refer_to_specialist(gp_visit, acc("cardio.near"), "rec-1".into(), H.into());
    assert!(c.can_access("rec-1".into(), acc("cardio.near")));

    // 3. patient books the specialist using the referral
    ctx("pat.near", near(3), NOW_MS);
    let sp_visit = c.book_consultation(acc("cardio.near"), SLOT, Some(referral));
    assert_eq!(c.get_referral(referral).unwrap().used_by_consultation, Some(sp_visit));

    // 4. specialist orders a lab test, patient pays, lab submits result
    ctx("cardio.near", NearToken::from_yoctonear(0), SLOT);
    let order = c.order_lab_test(sp_visit, acc("lab.near"), "rec-3".into(), H.into());
    assert!(c.can_access("rec-3".into(), acc("lab.near")));
    ctx("pat.near", near(2), SLOT);
    c.pay_lab_order(order);
    ctx("lab.near", NearToken::from_yoctonear(0), SLOT);
    c.submit_lab_result(order, "rec-lab-1".into(), H.into());
    assert_eq!(c.get_lab_order(order).unwrap().status, LabStatus::ResultReady);
    assert!(c.can_access("rec-lab-1".into(), acc("cardio.near")));
    assert!(c.can_access("rec-lab-1".into(), acc("pat.near")));
    assert!(!c.can_access("rec-lab-1".into(), acc("gp.near")));

    // patient decides to share the result with their GP too
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT);
    c.grant_access("rec-lab-1".into(), acc("gp.near"));
    assert!(c.can_access("rec-lab-1".into(), acc("gp.near")));

    // 5. specialist prescribes, completes visit
    ctx("cardio.near", NearToken::from_yoctonear(0), SLOT);
    let rx = c.issue_prescription(sp_visit, "rec-rx-1".into(), H.into(), 30);
    c.complete_consultation(sp_visit);

    // 6. patient picks a pharmacy, pharmacy quotes, patient pays, pharmacy dispenses
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT);
    c.assign_pharmacy(rx, acc("pharm.near"));
    assert!(c.can_access("rec-rx-1".into(), acc("pharm.near")));
    ctx("pharm.near", NearToken::from_yoctonear(0), SLOT);
    c.quote_prescription(rx, near(1));
    ctx("pat.near", near(1), SLOT);
    c.pay_prescription(rx);
    ctx("pharm.near", NearToken::from_yoctonear(0), SLOT);
    c.dispense_prescription(rx);
    assert_eq!(c.get_prescription(rx).unwrap().status, RxStatus::Dispensed);

    assert_eq!(c.consultations_for(acc("pat.near")).len(), 2);
    assert_eq!(c.prescriptions_for(acc("pharm.near")).len(), 1);
}

#[test]
#[should_panic(expected = "A referral is required")]
fn specialist_needs_referral() {
    let mut c = setup();
    ctx("pat.near", near(3), NOW_MS);
    c.book_consultation(acc("cardio.near"), SLOT, None);
}

#[test]
#[should_panic(expected = "Referral is for another patient")]
fn referral_not_transferable() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let v = c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("gp.near", NearToken::from_yoctonear(0), SLOT);
    let r = c.refer_to_specialist(v, acc("cardio.near"), "rec-2".into(), H.into());
    ctx("mallory.near", near(3), NOW_MS);
    c.book_consultation(acc("cardio.near"), SLOT, Some(r));
}

#[test]
#[should_panic(expected = "less than the consultation fee")]
fn underpaying_fails() {
    let mut c = setup();
    ctx("pat.near", NearToken::from_millinear(500), NOW_MS);
    c.book_consultation(acc("gp.near"), SLOT, None);
}

#[test]
#[should_panic(expected = "Slot already booked")]
fn no_double_booking() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("pat2.near", near(1), NOW_MS);
    c.book_consultation(acc("gp.near"), SLOT, None);
}

#[test]
#[should_panic(expected = "Provider is not verified")]
fn unverified_provider_cannot_be_booked() {
    let mut c = setup();
    ctx("fake.near", NearToken::from_yoctonear(0), NOW_MS);
    c.register_provider(Role::Physician, "Fake".into(), "".into(), "".into(), near(1));
    ctx("pat.near", near(1), NOW_MS);
    c.book_consultation(acc("fake.near"), SLOT, None);
}

#[test]
#[should_panic(expected = "already dispensed")]
fn prescription_dispensed_once() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let v = c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("gp.near", NearToken::from_yoctonear(0), SLOT);
    let rx = c.issue_prescription(v, "rx".into(), H.into(), 7);
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT);
    c.assign_pharmacy(rx, acc("pharm.near"));
    ctx("pharm.near", NearToken::from_yoctonear(0), SLOT);
    c.quote_prescription(rx, near(0));
    ctx("pat.near", near(0), SLOT);
    c.pay_prescription(rx);
    ctx("pharm.near", NearToken::from_yoctonear(0), SLOT);
    c.dispense_prescription(rx);
    c.dispense_prescription(rx);
}

#[test]
#[should_panic(expected = "Prescription expired")]
fn expired_prescription_rejected() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let v = c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("gp.near", NearToken::from_yoctonear(0), SLOT);
    let rx = c.issue_prescription(v, "rx".into(), H.into(), 1);
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT + 2 * MS_PER_DAY);
    c.assign_pharmacy(rx, acc("pharm.near"));
}

#[test]
fn patient_cancel_before_slot_and_after_no_show() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let a = c.book_consultation(acc("gp.near"), SLOT, None);
    c.cancel_consultation(a);
    assert_eq!(c.get_consultation(a).unwrap().status, ConsultStatus::Cancelled);
    // slot is free again
    assert!(!c.is_slot_booked(acc("gp.near"), SLOT));
    assert!(c.booked_slots(acc("gp.near")).is_empty());

    ctx("pat.near", near(1), NOW_MS);
    let b = c.book_consultation(acc("gp.near"), SLOT, None);
    assert_eq!(c.booked_slots(acc("gp.near")), vec![SLOT]);
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT + NO_SHOW_GRACE_MS);
    c.cancel_consultation(b);
    assert_eq!(c.get_consultation(b).unwrap().status, ConsultStatus::Cancelled);
}

#[test]
#[should_panic(expected = "Cannot cancel during the consultation window")]
fn patient_cannot_cancel_during_window() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let a = c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("pat.near", NearToken::from_yoctonear(0), SLOT + 1000);
    c.cancel_consultation(a);
}

#[test]
#[should_panic(expected = "Only the assigned lab")]
fn wrong_lab_cannot_submit() {
    let mut c = setup();
    ctx("pat.near", near(1), NOW_MS);
    let v = c.book_consultation(acc("gp.near"), SLOT, None);
    ctx("gp.near", NearToken::from_yoctonear(0), SLOT);
    let o = c.order_lab_test(v, acc("lab.near"), "rec-4".into(), H.into());
    ctx("pat.near", near(2), SLOT);
    c.pay_lab_order(o);
    ctx("evil-lab.near", NearToken::from_yoctonear(0), SLOT);
    c.submit_lab_result(o, "r".into(), H.into());
}

#[test]
#[should_panic(expected = "Only the patient can grant access")]
fn only_patient_grants_access() {
    let mut c = setup();
    ctx("pat.near", NearToken::from_yoctonear(0), NOW_MS);
    c.add_record("up1".into(), acc("pat.near"), RecordKind::PatientUpload, H.into(), None);
    ctx("gp.near", NearToken::from_yoctonear(0), NOW_MS);
    c.grant_access("up1".into(), acc("gp.near"));
}
