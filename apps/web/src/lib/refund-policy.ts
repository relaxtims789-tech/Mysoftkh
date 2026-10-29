/**
 * Cancellation & Refund Policy (English + Khmer). The one source for the payment page, the website page and the Word file
 * (tools/refund-policy-docx.mjs). When the text changes in substance, raise REFUND_POLICY_VERSION here AND in the API
 * (modules/billing/billing.service.ts): customers then accept the new version on their next payment.
 */

export const REFUND_POLICY_VERSION = '1.0';
export const REFUND_POLICY_EFFECTIVE = { en: '9 October 2026', km: '9 តុលា 2026' };
export const REFUND_POLICY_DOCX = '/legal/MySoft-Cancellation-Refund-Policy.docx';

export interface Bi {
  en: string;
  km: string;
}

export interface PolicySection {
  title: Bi;
  /** Paragraphs before the list. */
  text?: Bi[];
  items?: Bi[];
  /** Lettered items (a, b, c...). */
  lettered?: Bi[];
  /** Paragraphs after the list. */
  after?: Bi[];
}

export const REFUND_POLICY = {
  title: { en: 'Cancellation & Refund Policy', km: 'គោលការណ៍លុបចោល និងសងប្រាក់វិញ' },
  provider: {
    en: 'MySoft Attendance · QR and Phones Attendance, provided by MySoft KH',
    km: 'MySoft Attendance · QR and Phones Attendance ផ្តល់ជូនដោយ MySoft KH',
  },
  intro: {
    en: 'This policy explains how you can cancel your subscription to MySoft Attendance (the "Service") and when a payment can be refunded. It applies to every payment for the Service: online with ABA PayWay, by bank transfer to our ABA or ACLEDA account, or in cash. You must read and accept it before each payment.',
    km: 'គោលការណ៍នេះពន្យល់អំពីរបៀបលុបចោលការជាវ MySoft Attendance ("សេវាកម្ម") និងករណីណាខ្លះដែលប្រាក់ដែលបានបង់អាចសងវិញបាន។ វាអនុវត្តចំពោះការបង់ប្រាក់គ្រប់ប្រភេទសម្រាប់សេវាកម្មនេះ៖ តាមអនឡាញជាមួយ ABA PayWay ការផ្ទេរប្រាក់ទៅគណនី ABA ឬ ACLEDA របស់យើង ឬជាសាច់ប្រាក់។ អ្នកត្រូវអាន និងយល់ព្រមលើគោលការណ៍នេះ មុនពេលបង់ប្រាក់រាល់ដង។',
  },
  summaryTitle: { en: 'In short', km: 'សេចក្តីសង្ខេប' },
  summary: [
    { en: 'The free trial costs nothing and ends by itself. We never charge you automatically.', km: 'ការសាកល្បងឥតគិតថ្លៃ មិនគិតប្រាក់ទេ ហើយបញ្ចប់ដោយខ្លួនឯង។ យើងមិនកាត់ប្រាក់ពីអ្នកដោយស្វ័យប្រវត្តិឡើយ។' },
    { en: 'Plans are paid in advance, in US dollars, for 1 month or 12 months.', km: 'គម្រោងត្រូវបង់ជាមុន ជាប្រាក់ដុល្លារអាមេរិក សម្រាប់រយៈពេល ១ ខែ ឬ ១២ ខែ។' },
    { en: 'Payments are final and are not refunded, except in the cases listed in section 5 (errors by MySoft).', km: 'ប្រាក់ដែលបានបង់ហើយ មិនអាចសងវិញបានទេ លើកលែងតែករណីដែលមានចែងក្នុងផ្នែកទី ៥ (កំហុសរបស់ MySoft)។' },
    { en: 'You can cancel at any time by not renewing. Your plan keeps working until the end of the period you paid for.', km: 'អ្នកអាចលុបចោលបានគ្រប់ពេល ដោយមិនបន្តការបង់ប្រាក់។ គម្រោងរបស់អ្នកនៅតែដំណើរការ រហូតដល់ចុងរយៈពេលដែលអ្នកបានបង់។' },
    { en: 'You can export your data at any time, also after your plan has ended.', km: 'អ្នកអាចទាញយកទិន្នន័យរបស់អ្នកបានគ្រប់ពេល រួមទាំងក្រោយពេលគម្រោងបានបញ្ចប់។' },
  ] as Bi[],
  sections: [
    {
      title: { en: '1. Free trial', km: '១. ការសាកល្បងឥតគិតថ្លៃ' },
      items: [
        { en: 'New accounts get a free trial of 1 to 3 months (the length is shown when you sign up). No payment details are needed.', km: 'គណនីថ្មីទទួលបានការសាកល្បងឥតគិតថ្លៃ ១ ដល់ ៣ ខែ (រយៈពេលត្រូវបានបង្ហាញនៅពេលចុះឈ្មោះ)។ មិនចាំបាច់ផ្តល់ព័ត៌មានបង់ប្រាក់ទេ។' },
        { en: 'If no payment is made when the trial ends, the account keeps working for 7 more days (grace period) and then becomes read-only (see section 3).', km: 'ប្រសិនបើមិនមានការបង់ប្រាក់នៅពេលការសាកល្បងបញ្ចប់ គណនីនៅតែដំណើរការ ៧ ថ្ងៃទៀត (រយៈពេលអនុគ្រោះ) បន្ទាប់មកក្លាយជាគណនីអាចមើលបានតែប៉ុណ្ណោះ (សូមមើលផ្នែកទី ៣)។' },
      ],
    },
    {
      title: { en: '2. Payments', km: '២. ការបង់ប្រាក់' },
      items: [
        { en: 'Prices are in US dollars (USD) per month, based on the number of active staff and the branches included in the plan, as shown on www.mysoftkh.com and on the payment page.', km: 'តម្លៃគិតជាប្រាក់ដុល្លារអាមេរិក (USD) ក្នុងមួយខែ ផ្អែកលើចំនួនបុគ្គលិកសកម្ម និងចំនួនសាខាដែលមានក្នុងគម្រោង ដូចដែលបង្ហាញនៅលើ www.mysoftkh.com និងនៅលើទំព័របង់ប្រាក់។' },
        { en: 'Every payment is made in advance and covers the period shown on the invoice (1 month or 12 months). A new period starts the day after your current trial or paid period ends, so paying early never loses you any days.', km: 'ការបង់ប្រាក់នីមួយៗត្រូវបង់ជាមុន ហើយគ្របដណ្តប់រយៈពេលដែលបង្ហាញនៅលើវិក្កយបត្រ (១ ខែ ឬ ១២ ខែ)។ រយៈពេលថ្មីចាប់ផ្តើមនៅថ្ងៃបន្ទាប់ពីការសាកល្បង ឬរយៈពេលដែលបានបង់បច្ចុប្បន្នបញ្ចប់ ដូច្នេះការបង់មុនមិនធ្វើឲ្យអ្នកបាត់បង់ថ្ងៃណាមួយឡើយ។' },
        { en: 'You can pay online with ABA PayWay (KHQR, ABA Pay or card) or by bank transfer to our ABA or ACLEDA account. A bank transfer is activated after we check your receipt, normally within one working day.', km: 'អ្នកអាចបង់តាមអនឡាញជាមួយ ABA PayWay (KHQR, ABA Pay ឬកាត) ឬផ្ទេរប្រាក់ទៅគណនី ABA ឬ ACLEDA របស់យើង។ ការផ្ទេរប្រាក់តាមធនាគារនឹងដំណើរការ បន្ទាប់ពីយើងពិនិត្យបង្កាន់ដៃរបស់អ្នក ជាធម្មតាក្នុងរយៈពេលមួយថ្ងៃធ្វើការ។' },
        { en: 'Please transfer the exact amount and write the invoice number in the remark. Fees charged by your own bank or card provider are paid by you.', km: 'សូមផ្ទេរប្រាក់ឲ្យត្រូវចំនួន ហើយសរសេរលេខវិក្កយបត្រនៅក្នុងចំណាំ (remark)។ កម្រៃដែលធនាគារ ឬអ្នកផ្តល់កាតរបស់អ្នកគិត ជាបន្ទុករបស់អ្នក។' },
        { en: 'There is no automatic renewal: you decide when to pay the next invoice.', km: 'មិនមានការបន្តដោយស្វ័យប្រវត្តិទេ៖ អ្នកជាអ្នកសម្រេចថាពេលណាត្រូវបង់វិក្កយបត្របន្ទាប់។' },
      ],
    },
    {
      title: { en: '3. Cancellation', km: '៣. ការលុបចោល' },
      items: [
        { en: 'To cancel, simply do not pay the next invoice. Unpaid invoices can be cancelled at any time on the Billing & plan page. Nothing more is charged.', km: 'ដើម្បីលុបចោល អ្នកគ្រាន់តែមិនបង់វិក្កយបត្របន្ទាប់។ វិក្កយបត្រដែលមិនទាន់បង់ អាចលុបចោលបានគ្រប់ពេលនៅលើទំព័រ Billing & plan។ គ្មានការគិតប្រាក់បន្ថែមទៀតទេ។' },
        { en: 'After the paid period ends, the account keeps working for 7 days (grace period). It then becomes read-only: administrators can still sign in, view and export data, and pay to continue, but staff cannot record attendance.', km: 'បន្ទាប់ពីរយៈពេលដែលបានបង់បញ្ចប់ គណនីនៅតែដំណើរការ ៧ ថ្ងៃ (រយៈពេលអនុគ្រោះ)។ បន្ទាប់មកវាក្លាយជាគណនីអាចមើលបានតែប៉ុណ្ណោះ៖ អ្នកគ្រប់គ្រងនៅតែអាចចូលគណនី មើល និងទាញយកទិន្នន័យ និងបង់ប្រាក់ដើម្បីបន្ត ប៉ុន្តែបុគ្គលិកមិនអាចចុះវត្តមានបានទេ។' },
        { en: 'Cancelling does not end the current paid period early and does not give a refund for the time left.', km: 'ការលុបចោលមិនបញ្ចប់រយៈពេលដែលបានបង់បច្ចុប្បន្នមុនកាលកំណត់ទេ ហើយមិនមានការសងប្រាក់សម្រាប់រយៈពេលដែលនៅសល់ឡើយ។' },
        { en: 'To close your account and delete your data, contact us (section 8); please export the reports you need first. We keep the data of a read-only account for at least 12 months unless you ask us to delete it sooner.', km: 'ដើម្បីបិទគណនី និងលុបទិន្នន័យរបស់អ្នក សូមទាក់ទងមកយើង (ផ្នែកទី ៨) ហើយសូមទាញយករបាយការណ៍ដែលអ្នកត្រូវការជាមុនសិន។ យើងរក្សាទុកទិន្នន័យរបស់គណនីដែលអាចមើលបានតែប៉ុណ្ណោះ យ៉ាងតិច ១២ ខែ លុះត្រាតែអ្នកស្នើសុំឲ្យលុបមុននោះ។' },
      ],
    },
    {
      title: { en: '4. Changing your plan', km: '៤. ការផ្លាស់ប្តូរគម្រោង' },
      items: [
        { en: 'Upgrade (more staff or branches) during a paid period: you pay the price difference for the months left. The new plan starts when the payment is confirmed; the end date does not change.', km: 'ដំឡើងគម្រោង (បុគ្គលិក ឬសាខាច្រើនជាង) ក្នុងរយៈពេលដែលបានបង់៖ អ្នកបង់តែភាពខុសគ្នានៃតម្លៃ សម្រាប់ខែដែលនៅសល់។ គម្រោងថ្មីចាប់ផ្តើមនៅពេលការបង់ប្រាក់ត្រូវបានបញ្ជាក់ ហើយកាលបរិច្ឆេទបញ្ចប់មិនផ្លាស់ប្តូរទេ។' },
        { en: 'Downgrade: takes effect from the next period you pay for. There is no refund or credit for the current period.', km: 'បន្ថយគម្រោង៖ មានប្រសិទ្ធភាពចាប់ពីរយៈពេលបន្ទាប់ដែលអ្នកបង់។ មិនមានការសងប្រាក់ ឬឥណទានសម្រាប់រយៈពេលបច្ចុប្បន្នទេ។' },
        { en: 'Removing staff or branches, or using fewer features, does not reduce an amount already paid.', km: 'ការដកបុគ្គលិក ឬសាខាចេញ ឬការប្រើមុខងារតិចជាងមុន មិនកាត់បន្ថយចំនួនប្រាក់ដែលបានបង់រួចហើយទេ។' },
      ],
    },
    {
      title: { en: '5. Refunds', km: '៥. ការសងប្រាក់វិញ' },
      text: [
        { en: 'All payments are final and non-refundable. This includes: time left in a monthly or yearly plan; cancelling early; moving to a smaller plan; having fewer staff or branches than the plan allows; features you did not use; and an account suspended for breaking our Terms of Use, or because a payment was disputed with the bank without contacting us first.', km: 'ការបង់ប្រាក់ទាំងអស់គឺចុងក្រោយ ហើយមិនអាចសងវិញបានទេ។ នេះរួមបញ្ចូល៖ រយៈពេលដែលនៅសល់ក្នុងគម្រោងប្រចាំខែ ឬប្រចាំឆ្នាំ ការលុបចោលមុនកាលកំណត់ ការប្តូរទៅគម្រោងតូចជាង ការមានបុគ្គលិក ឬសាខាតិចជាងគម្រោងអនុញ្ញាត មុខងារដែលអ្នកមិនបានប្រើ និងគណនីដែលត្រូវបានផ្អាកដោយសារការរំលោភលក្ខខណ្ឌប្រើប្រាស់ ឬដោយសារការប្តឹងតវ៉ាការបង់ប្រាក់ជាមួយធនាគារ ដោយមិនបានទាក់ទងមកយើងជាមុន។' },
        { en: 'We refund only in these cases, which are errors on our side:', km: 'យើងសងប្រាក់វិញតែក្នុងករណីខាងក្រោមប៉ុណ្ណោះ ដែលជាកំហុសរបស់យើង៖' },
      ],
      lettered: [
        { en: 'Duplicate payment: the same invoice was paid more than once. The extra payment is refunded in full.', km: 'ការបង់ប្រាក់ស្ទួន៖ វិក្កយបត្រតែមួយត្រូវបានបង់លើសពីម្តង។ ប្រាក់ដែលបង់លើសនឹងត្រូវសងវិញទាំងស្រុង។' },
        { en: 'Wrong amount: you were charged, or asked to pay, more than the invoice amount. The difference is refunded.', km: 'ចំនួនទឹកប្រាក់ខុស៖ អ្នកត្រូវបានគិត ឬស្នើឲ្យបង់លើសពីចំនួនក្នុងវិក្កយបត្រ។ ភាពខុសគ្នានឹងត្រូវសងវិញ។' },
        { en: 'Payment we could not apply: we cancelled the invoice, or could not provide the plan you paid for. Refunded in full.', km: 'ការបង់ប្រាក់ដែលយើងមិនអាចអនុវត្តបាន៖ យើងបានលុបចោលវិក្កយបត្រ ឬមិនអាចផ្តល់គម្រោងដែលអ្នកបានបង់។ សងវិញទាំងស្រុង។' },
        { en: 'Service unavailable because of MySoft: if the Service could not be used for more than 72 hours in a row during a paid period because of a fault on our side, we add the lost days to your paid period or, if you ask, refund the amount for those days.', km: 'សេវាកម្មមិនអាចប្រើបានដោយសារ MySoft៖ ប្រសិនបើសេវាកម្មមិនអាចប្រើបានលើសពី ៧២ ម៉ោងជាប់គ្នា ក្នុងរយៈពេលដែលបានបង់ ដោយសារកំហុសខាងយើង យើងនឹងបន្ថែមថ្ងៃដែលបាត់បង់ទៅក្នុងរយៈពេលដែលបានបង់របស់អ្នក ឬប្រសិនបើអ្នកស្នើសុំ យើងនឹងសងប្រាក់សម្រាប់ថ្ងៃទាំងនោះ។' },
        { en: 'Paid for the wrong company or plan by mistake: we move the payment to the right company or plan (it is not paid back).', km: 'បង់ឲ្យក្រុមហ៊ុន ឬគម្រោងខុសដោយច្រឡំ៖ យើងនឹងផ្ទេរការបង់ប្រាក់នោះទៅក្រុមហ៊ុន ឬគម្រោងដែលត្រឹមត្រូវ (មិនសងជាប្រាក់វិញទេ)។' },
      ],
      after: [
        { en: 'Not covered: problems caused by the internet, your phones or computers, power cuts, Telegram, banks or ABA PayWay, or maintenance announced in advance.', km: 'មិនរាប់បញ្ចូល៖ បញ្ហាដែលបណ្តាលមកពីអ៊ីនធឺណិត ទូរស័ព្ទ ឬកុំព្យូទ័ររបស់អ្នក ការដាច់ភ្លើង Telegram ធនាគារ ឬ ABA PayWay ឬការថែទាំប្រព័ន្ធដែលបានជូនដំណឹងជាមុន។' },
      ],
    },
    {
      title: { en: '6. How to ask for a refund', km: '៦. របៀបស្នើសុំសងប្រាក់វិញ' },
      items: [
        { en: 'Contact us within 30 days of the payment with your company code, the invoice number, and the payment receipt or ABA PayWay transaction.', km: 'សូមទាក់ទងមកយើងក្នុងរយៈពេល ៣០ ថ្ងៃ បន្ទាប់ពីការបង់ប្រាក់ ដោយភ្ជាប់លេខកូដក្រុមហ៊ុន លេខវិក្កយបត្រ និងបង្កាន់ដៃបង់ប្រាក់ ឬប្រតិបត្តិការ ABA PayWay។' },
        { en: 'We reply within 3 working days. An approved refund is paid in full, in US dollars, to the same payment method or bank account that was used, within 14 working days (your bank may need a few more days).', km: 'យើងនឹងឆ្លើយតបក្នុងរយៈពេល ៣ ថ្ងៃធ្វើការ។ ការសងប្រាក់ដែលត្រូវបានអនុម័ត នឹងត្រូវសងវិញទាំងស្រុងជាប្រាក់ដុល្លារអាមេរិក ទៅកាន់វិធីបង់ប្រាក់ ឬគណនីធនាគារដដែលដែលបានប្រើ ក្នុងរយៈពេល ១៤ ថ្ងៃធ្វើការ (ធនាគាររបស់អ្នកអាចត្រូវការពេលបន្ថែមខ្លះ)។' },
        { en: 'If you see a problem with a payment, please contact us before opening a dispute (chargeback) with your bank. While a payment is disputed, the plan it paid for may be paused.', km: 'ប្រសិនបើអ្នកឃើញបញ្ហាជាមួយការបង់ប្រាក់ សូមទាក់ទងមកយើងជាមុនសិន មុននឹងដាក់ពាក្យប្តឹងតវ៉ា (chargeback) ជាមួយធនាគាររបស់អ្នក។ ក្នុងពេលការបង់ប្រាក់កំពុងត្រូវបានតវ៉ា គម្រោងដែលបានបង់ដោយប្រាក់នោះអាចត្រូវបានផ្អាក។' },
      ],
    },
    {
      title: { en: '7. Changes to this policy', km: '៧. ការកែប្រែគោលការណ៍នេះ' },
      items: [
        { en: 'We may update this policy. The current version is always shown on the payment page and on www.mysoftkh.com. A change applies only to payments made after it is published, and the version you accepted is recorded with each invoice.', km: 'យើងអាចធ្វើបច្ចុប្បន្នភាពគោលការណ៍នេះ។ កំណែបច្ចុប្បន្នតែងតែបង្ហាញនៅលើទំព័របង់ប្រាក់ និងនៅលើ www.mysoftkh.com។ ការផ្លាស់ប្តូរអនុវត្តតែចំពោះការបង់ប្រាក់ដែលធ្វើឡើងបន្ទាប់ពីការផ្សព្វផ្សាយប៉ុណ្ណោះ ហើយកំណែដែលអ្នកបានយល់ព្រម ត្រូវបានកត់ត្រាជាមួយវិក្កយបត្រនីមួយៗ។' },
      ],
    },
    {
      title: { en: '8. Contact', km: '៨. ទំនាក់ទំនង' },
      text: [
        { en: 'MySoft KH · Telegram: @mysoftkh · Phone: 014 789 987 · 096 89 99 169 · Website: www.mysoftkh.com', km: 'MySoft KH · Telegram: @mysoftkh · ទូរស័ព្ទ: 014 789 987 · 096 89 99 169 · គេហទំព័រ: www.mysoftkh.com' },
        { en: 'This policy is governed by the laws of the Kingdom of Cambodia.', km: 'គោលការណ៍នេះស្ថិតនៅក្រោមច្បាប់នៃព្រះរាជាណាចក្រកម្ពុជា។' },
      ],
    },
  ] as PolicySection[],
  acknowledgeTitle: { en: 'Acknowledgement', km: 'ការទទួលស្គាល់' },
  acknowledge: {
    en: 'I have read and agree to the Cancellation & Refund Policy (version 1.0). I understand that payments are final and are refunded only in the cases listed in section 5.',
    km: 'ខ្ញុំបានអាន និងយល់ព្រមលើគោលការណ៍លុបចោល និងសងប្រាក់វិញ (កំណែ 1.0)។ ខ្ញុំយល់ថា ប្រាក់ដែលបានបង់ហើយមិនអាចសងវិញបានទេ លើកលែងតែករណីដែលមានចែងក្នុងផ្នែកទី ៥។',
  },
  acknowledgeNote: {
    en: 'You tick this box on the payment page before each payment. Your name, the policy version and the date and time are saved with the invoice. This policy is available in English and Khmer; if the two versions differ, the English version applies.',
    km: 'អ្នកត្រូវធីកប្រអប់នេះនៅលើទំព័របង់ប្រាក់ មុនពេលបង់ប្រាក់រាល់ដង។ ឈ្មោះរបស់អ្នក កំណែគោលការណ៍ និងកាលបរិច្ឆេទ និងម៉ោង ត្រូវបានរក្សាទុកជាមួយវិក្កយបត្រ។ គោលការណ៍នេះមានជាភាសាអង់គ្លេស និងភាសាខ្មែរ។ ប្រសិនបើកំណែទាំងពីរខុសគ្នា កំណែភាសាអង់គ្លេសត្រូវយកជាការ។',
  },
  versionLabel: { en: 'Version', km: 'កំណែ' },
  effectiveLabel: { en: 'Effective', km: 'ចូលជាធរមាន' },
};
