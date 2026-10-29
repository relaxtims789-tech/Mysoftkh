import { useEffect, useState } from 'react';

/** Public website texts in English and Khmer. `{name}` placeholders are filled by t(). */

export type Lang = 'en' | 'km';

const en = {
  brand: 'MySoft Attendance',
  'nav.features': 'Features',
  'nav.how': 'How it works',
  'nav.pricing': 'Pricing',
  'nav.faq': 'FAQ',
  'nav.signin': 'Sign in',
  'nav.open': 'Open dashboard',
  'nav.start': 'Start free trial',
  'nav.lang': 'ខ្មែរ',

  'hero.kicker': 'Attendance · Overtime · Payroll',
  'hero.title': "Staff attendance on your team's own phones",
  'hero.sub': 'Print a QR code for each branch. Staff scan it with their phone to check in and out, and GPS and phone checks stop cheating. No attendance machine, tablet or kiosk to buy.',
  'hero.cta': 'Start free trial',
  'hero.cta2': 'See prices',
  'hero.note': '{months}-month free trial · no card needed',
  'hero.p1': 'No machine to buy',
  'hero.p2': 'iPhone, Android and Huawei',
  'hero.p3': 'Payroll with Tax on Salary & NSSF',
  'mock.hello': 'Good morning, Dara',
  'mock.ok': 'Checked in',
  'mock.where': 'CAM Phnom Penh · 12 m from the QR',
  'mock.in': 'Check-in',
  'mock.out': 'Check-out',

  'features.title': 'Everything you need to run attendance and payroll',
  'features.sub': 'One system for the office, the shop floor and every branch.',
  'f1.t': 'QR code + GPS check-in',
  'f1.d': 'Staff scan the branch QR code. The system checks they are really inside the branch area, from 0.5 m up.',
  'f2.t': 'One phone per employee',
  'f2.d': 'Each employee registers their phone once. Other phones are refused, so nobody checks in for a friend.',
  'f3.t': 'One-tap check-in (optional)',
  'f3.d': 'Let staff check in and out with a single tap at the branch, without scanning.',
  'f4.t': 'Live dashboard',
  'f4.d': 'See who is in, late or absent right now, at every branch.',
  'f5.t': 'Overtime with approval',
  'f5.d': 'Overtime per hour or per day on work days, days off and holidays. Managers approve it.',
  'f6.t': 'Payroll for Cambodia',
  'f6.d': 'Salary from attendance, allowances, advances, Tax on Salary in riel and NSSF. Payslips on every phone and a transfer list for ABA / ACLEDA.',
  'f7.t': 'Leave and corrections',
  'f7.d': 'Staff request leave or fix a missed scan from their phone; HR approves.',
  'f8.t': 'Reports in Excel and PDF',
  'f8.d': 'Daily, monthly, late, absent, overtime and payroll reports, ready to export.',

  'how.title': 'Start in 3 steps',
  'how.1t': 'Create your account',
  'how.1d': 'Register your company in 2 minutes and get a free trial.',
  'how.2t': 'Add branches and staff',
  'how.2d': 'Pin each branch on the map, add employees (or import a CSV file) and print the QR posters.',
  'how.3t': 'Staff scan with their phone',
  'how.3d': 'Employees open the app on their phone, sign in once and scan to check in.',

  'pricing.title': 'Simple prices by number of staff',
  'pricing.sub': 'All features included. Free for {period}, then pay monthly or yearly.',
  'pricing.monthly': 'Monthly',
  'pricing.yearly': 'Yearly',
  'pricing.yearlyFree': '{free} months free',
  'pricing.staff': '{min}–{max} staff',
  'pricing.branch1': '1 branch',
  'pricing.branches': 'Up to {n} branches',
  'pricing.branchesUnlimited': 'Unlimited branches',
  'pricing.perMonth': '/ month',
  'pricing.perYear': '/ year',
  'pricing.choose': 'Start free',
  'pricing.popular': 'Popular',
  'pricing.pay': 'Pay with ABA PayWay (KHQR, ABA Pay, cards) or by bank transfer to ABA or ACLEDA.',
  'pricing.more': 'More than 3,000 staff? Contact us for a price.',
  'pricing.bigTitle': '3,000+ staff',
  'pricing.bigPrice': 'Custom price',
  'pricing.contact': 'Contact us',

  'faq.title': 'Questions',
  'q1': 'Do we need to buy an attendance machine?',
  'a1': 'No. You only print a QR code for each branch. Staff use their own smartphones.',
  'q2': 'Can staff check in from home?',
  'a2': "No. The phone's GPS must be inside the branch area, each employee can only use their registered phone, and every scan is signed by that phone.",
  'q3': 'Which phones work?',
  'a3': 'iPhone, Android and Huawei (HarmonyOS) phones with a camera and GPS, in the normal web browser. Nothing to install from a store.',
  'q4': 'What happens after the free trial?',
  'a4': "Choose a plan and pay in Billing. If you don't, you keep {grace} more days; then the account becomes read-only. You can still see and export your data, and you continue as soon as you pay.",
  'q5': 'How do we pay?',
  'a5': 'Online with ABA PayWay (KHQR from any Cambodian bank app, ABA Pay or card), or by bank transfer to our ABA or ACLEDA account and uploading the receipt.',
  'q6': 'Is our data safe?',
  'a6': "Each company's data is kept separate, all traffic uses HTTPS, passwords are encrypted and the database is backed up every night.",

  'cta.title': 'Try it free with your team',
  'cta.sub': 'Set up in minutes. Cancel any time.',
  'contact.title': 'Talk to us',
  'contact.sub': 'Questions, a demo or help setting up? We reply in Khmer and English.',
  'contact.scan': 'Scan with your phone to chat with us on Telegram',
  'nav.contact': 'Contact',
  'demo.title': 'Live demo.',
  'demo.text': 'A sample company with 6 months of data. Try everything; it is put back every night at {reset}:00.',
  'demo.admin': 'Dashboard sign-in',
  'demo.app': 'Staff app: company code / employee ID',
  'demo.password': 'Password',
  'demo.openAdmin': 'Open the demo dashboard',
  'demo.openApp': 'Open the staff app',
  'contact.phone': 'Phone',
  'contact.telegram': 'Telegram',
  'contact.email': 'Email',
  'footer.rights': '© {year} MySoft KH. All rights reserved.',
  'footer.terms': 'Terms & privacy',
  'footer.refund': 'Cancellation & refunds',
  'refund.download': 'Download as Word (.docx)',

  'signup.title': 'Create your free account',
  'signup.sub': '{months}-month free trial. No card needed.',
  'signup.companyName': 'Company name',
  'signup.companyCode': 'Company code',
  'signup.codeHint': 'Staff type this when they sign in. Letters and numbers.',
  'signup.codeTaken': 'Already used, choose another',
  'signup.codeFree': 'Available',
  'signup.fullName': 'Your name',
  'signup.email': 'Email',
  'signup.phone': 'Phone number',
  'signup.password': 'Password',
  'signup.passwordHint': 'At least 8 characters, with a letter and a number.',
  'signup.staff': 'Number of staff',
  'signup.terms': 'I agree to the',
  'signup.termsLink': 'terms of use',
  'signup.submit': 'Create account',
  'signup.busy': 'Creating your account…',
  'signup.have': 'Already have an account?',
  'signup.after': 'Free until {date}, then {price} a month for {min}–{max} staff.',
  'signup.why1': 'Free for {period}, all features',
  'signup.why2': 'Your own company code and admin account',
  'signup.why3': 'Help in Khmer and English',

  'terms.title': 'Terms of use & privacy',
} as const;

type Key = keyof typeof en;

const km: Record<Key, string> = {
  brand: 'MySoft Attendance',
  'nav.features': 'មុខងារ',
  'nav.how': 'របៀបប្រើ',
  'nav.pricing': 'តម្លៃ',
  'nav.faq': 'សំណួរ',
  'nav.signin': 'ចូលគណនី',
  'nav.open': 'បើកផ្ទាំងគ្រប់គ្រង',
  'nav.start': 'សាកល្បងឥតគិតថ្លៃ',
  'nav.lang': 'English',

  'hero.kicker': 'វត្តមាន · ម៉ោងបន្ថែម · ប្រាក់ខែ',
  'hero.title': 'ចុះវត្តមានបុគ្គលិក ដោយប្រើទូរស័ព្ទរបស់ពួកគេផ្ទាល់',
  'hero.sub': 'បោះពុម្ព QR កូដសម្រាប់សាខានីមួយៗ។ បុគ្គលិកស្កេនដោយទូរស័ព្ទ ដើម្បីចុះវត្តមានចូល និងចេញ ហើយការត្រួតពិនិត្យ GPS និងទូរស័ព្ទ ការពារការបន្លំ។ មិនចាំបាច់ទិញម៉ាស៊ីនស្កេន ថេប្លេត ឬឧបករណ៍ផ្សេងទៀតទេ។',
  'hero.cta': 'សាកល្បងឥតគិតថ្លៃ',
  'hero.cta2': 'មើលតម្លៃ',
  'hero.note': 'សាកល្បងឥតគិតថ្លៃ {months} ខែ · មិនចាំបាច់ប្រើកាត',
  'hero.p1': 'មិនចាំបាច់ទិញម៉ាស៊ីន',
  'hero.p2': 'iPhone, Android និង Huawei',
  'hero.p3': 'ប្រាក់ខែ ពន្ធលើប្រាក់បៀវត្ស និង ប.ស.ស.',
  'mock.hello': 'អរុណសួស្តី ដារ៉ា',
  'mock.ok': 'បានចុះវត្តមានចូល',
  'mock.where': 'CAM ភ្នំពេញ · ១២ ម៉ែត្រពី QR',
  'mock.in': 'ចូល',
  'mock.out': 'ចេញ',

  'features.title': 'អ្វីៗដែលអ្នកត្រូវការ សម្រាប់គ្រប់គ្រងវត្តមាន និងប្រាក់ខែ',
  'features.sub': 'ប្រព័ន្ធតែមួយ សម្រាប់ការិយាល័យ រោងចក្រ និងគ្រប់សាខា។',
  'f1.t': 'ស្កេន QR កូដ + GPS',
  'f1.d': 'បុគ្គលិកស្កេន QR កូដរបស់សាខា។ ប្រព័ន្ធពិនិត្យថាពួកគេពិតជានៅក្នុងបរិវេណសាខាមែន ចាប់ពី ០,៥ ម៉ែត្រឡើងទៅ។',
  'f2.t': 'ទូរស័ព្ទមួយ សម្រាប់បុគ្គលិកម្នាក់',
  'f2.d': 'បុគ្គលិកម្នាក់ៗចុះឈ្មោះទូរស័ព្ទរបស់ខ្លួនតែម្តង។ ទូរស័ព្ទផ្សេងត្រូវបានបដិសេធ ដូច្នេះគ្មាននរណាចុះវត្តមានជំនួសមិត្តភក្តិបានទេ។',
  'f3.t': 'ចុះវត្តមានដោយចុចតែម្តង (ជម្រើស)',
  'f3.d': 'អនុញ្ញាតឲ្យបុគ្គលិកចុះវត្តមានចូល និងចេញ ដោយចុចតែម្តងនៅសាខា ដោយមិនចាំបាច់ស្កេន។',
  'f4.t': 'ផ្ទាំងគ្រប់គ្រងផ្ទាល់',
  'f4.d': 'មើលភ្លាមៗថា អ្នកណាមកធ្វើការ មកយឺត ឬអវត្តមាន នៅគ្រប់សាខា។',
  'f5.t': 'ម៉ោងបន្ថែម (OT) និងការអនុម័ត',
  'f5.d': 'គិត OT តាមម៉ោង ឬតាមថ្ងៃ នៅថ្ងៃធ្វើការ ថ្ងៃឈប់សម្រាក និងថ្ងៃបុណ្យ។ អ្នកគ្រប់គ្រងជាអ្នកអនុម័ត។',
  'f6.t': 'ប្រាក់ខែស្របតាមកម្ពុជា',
  'f6.d': 'ប្រាក់ខែតាមវត្តមាន ប្រាក់ឧបត្ថម្ភ ប្រាក់បុរេប្រទាន ពន្ធលើប្រាក់បៀវត្សជាប្រាក់រៀល និង ប.ស.ស.។ ប័ណ្ណបើកប្រាក់ខែលើទូរស័ព្ទបុគ្គលិក និងបញ្ជីផ្ទេរប្រាក់សម្រាប់ ABA / ACLEDA។',
  'f7.t': 'ច្បាប់ឈប់សម្រាក និងការកែតម្រូវ',
  'f7.d': 'បុគ្គលិកស្នើសុំច្បាប់ ឬកែការស្កេនដែលភ្លេច តាមទូរស័ព្ទ ហើយ HR ជាអ្នកអនុម័ត។',
  'f8.t': 'របាយការណ៍ Excel និង PDF',
  'f8.d': 'របាយការណ៍ប្រចាំថ្ងៃ ប្រចាំខែ ការមកយឺត អវត្តមាន ម៉ោងបន្ថែម និងប្រាក់ខែ ទាញយកបានភ្លាមៗ។',

  'how.title': 'ចាប់ផ្តើមក្នុង ៣ ជំហាន',
  'how.1t': 'បង្កើតគណនី',
  'how.1d': 'ចុះឈ្មោះក្រុមហ៊ុនរបស់អ្នកក្នុងរយៈពេល ២ នាទី ហើយទទួលបានការសាកល្បងឥតគិតថ្លៃ។',
  'how.2t': 'បន្ថែមសាខា និងបុគ្គលិក',
  'how.2d': 'កំណត់ទីតាំងសាខានីមួយៗលើផែនទី បន្ថែមបុគ្គលិក (ឬនាំចូលពីឯកសារ CSV) ហើយបោះពុម្ពផ្ទាំង QR។',
  'how.3t': 'បុគ្គលិកស្កេនដោយទូរស័ព្ទ',
  'how.3d': 'បុគ្គលិកបើកកម្មវិធីលើទូរស័ព្ទ ចូលគណនីតែម្តង ហើយស្កេនដើម្បីចុះវត្តមាន។',

  'pricing.title': 'តម្លៃសាមញ្ញ តាមចំនួនបុគ្គលិក',
  'pricing.sub': 'មុខងារទាំងអស់មានរួចជាស្រេច។ ឥតគិតថ្លៃ {period} បន្ទាប់មកបង់ប្រចាំខែ ឬប្រចាំឆ្នាំ។',
  'pricing.monthly': 'ប្រចាំខែ',
  'pricing.yearly': 'ប្រចាំឆ្នាំ',
  'pricing.yearlyFree': 'ឥតគិតថ្លៃ {free} ខែ',
  'pricing.staff': 'បុគ្គលិក {min}–{max} នាក់',
  'pricing.branch1': 'សាខា ១',
  'pricing.branches': 'រហូតដល់ {n} សាខា',
  'pricing.branchesUnlimited': 'សាខាមិនកំណត់',
  'pricing.perMonth': '/ ខែ',
  'pricing.perYear': '/ ឆ្នាំ',
  'pricing.choose': 'ចាប់ផ្តើមឥតគិតថ្លៃ',
  'pricing.popular': 'ពេញនិយម',
  'pricing.pay': 'បង់ប្រាក់តាម ABA PayWay (KHQR, ABA Pay, កាត) ឬផ្ទេរប្រាក់តាមធនាគារ ABA ឬ ACLEDA។',
  'pricing.more': 'បុគ្គលិកលើសពី ៣,០០០ នាក់? សូមទាក់ទងមកយើងដើម្បីសួរតម្លៃ។',
  'pricing.bigTitle': 'បុគ្គលិកលើស ៣,០០០ នាក់',
  'pricing.bigPrice': 'តម្លៃពិសេស',
  'pricing.contact': 'ទាក់ទងមកយើង',

  'faq.title': 'សំណួរដែលសួរញឹកញាប់',
  'q1': 'តើយើងត្រូវទិញម៉ាស៊ីនស្កេនវត្តមានទេ?',
  'a1': 'ទេ។ អ្នកគ្រាន់តែបោះពុម្ព QR កូដសម្រាប់សាខានីមួយៗ។ បុគ្គលិកប្រើស្មាតហ្វូនរបស់ខ្លួនផ្ទាល់។',
  'q2': 'តើបុគ្គលិកអាចចុះវត្តមានពីផ្ទះបានទេ?',
  'a2': 'មិនបានទេ។ GPS របស់ទូរស័ព្ទត្រូវតែនៅក្នុងបរិវេណសាខា បុគ្គលិកម្នាក់ៗប្រើបានតែទូរស័ព្ទដែលបានចុះឈ្មោះ ហើយការស្កេននីមួយៗត្រូវបានចុះហត្ថលេខាដោយទូរស័ព្ទនោះ។',
  'q3': 'តើទូរស័ព្ទប្រភេទណាខ្លះប្រើបាន?',
  'a3': 'iPhone, Android និង Huawei (HarmonyOS) ដែលមានកាមេរ៉ា និង GPS តាមរយៈកម្មវិធីរុករកអ៊ីនធឺណិតធម្មតា។ មិនចាំបាច់ដំឡើងពី Store ទេ។',
  'q4': 'តើមានអ្វីកើតឡើង ក្រោយពេលសាកល្បងឥតគិតថ្លៃ?',
  'a4': 'ជ្រើសរើសគម្រោង ហើយបង់ប្រាក់នៅក្នុងផ្នែក Billing។ បើមិនទាន់បង់ អ្នកនៅប្រើបាន {grace} ថ្ងៃទៀត បន្ទាប់មកគណនីអាចមើលបានតែប៉ុណ្ណោះ។ អ្នកនៅតែអាចមើល និងទាញយកទិន្នន័យ ហើយបន្តប្រើបានភ្លាមៗពេលបង់ប្រាក់។',
  'q5': 'តើយើងបង់ប្រាក់ដោយរបៀបណា?',
  'a5': 'បង់តាមអនឡាញជាមួយ ABA PayWay (KHQR ពីកម្មវិធីធនាគារណាមួយនៅកម្ពុជា ABA Pay ឬកាត) ឬផ្ទេរប្រាក់ទៅគណនី ABA ឬ ACLEDA របស់យើង រួចផ្ញើរូបបង្កាន់ដៃ។',
  'q6': 'តើទិន្នន័យរបស់យើងមានសុវត្ថិភាពទេ?',
  'a6': 'ទិន្នន័យរបស់ក្រុមហ៊ុននីមួយៗត្រូវបានរក្សាទុកដាច់ដោយឡែក ការតភ្ជាប់ទាំងអស់ប្រើ HTTPS ពាក្យសម្ងាត់ត្រូវបានអ៊ិនគ្រីប ហើយទិន្នន័យត្រូវបានបម្រុងទុករៀងរាល់យប់។',

  'cta.title': 'សាកល្បងឥតគិតថ្លៃជាមួយក្រុមការងាររបស់អ្នក',
  'cta.sub': 'រៀបចំបានក្នុងរយៈពេលប៉ុន្មាននាទី។ ឈប់ប្រើបានគ្រប់ពេល។',
  'contact.title': 'ទាក់ទងមកយើង',
  'contact.sub': 'មានសំណួរ ចង់មើលការបង្ហាញសាកល្បង ឬត្រូវការជំនួយក្នុងការរៀបចំ? យើងឆ្លើយតបជាភាសាខ្មែរ និងអង់គ្លេស។',
  'contact.scan': 'ស្កេនដោយទូរស័ព្ទ ដើម្បីជជែកជាមួយយើងតាម Telegram',
  'nav.contact': 'ទំនាក់ទំនង',
  'demo.title': 'ការបង្ហាញសាកល្បងផ្ទាល់។',
  'demo.text': 'ក្រុមហ៊ុនគំរូដែលមានទិន្នន័យ ៦ ខែ។ សាកល្បងបានគ្រប់មុខងារ ហើយទិន្នន័យនឹងត្រលប់ដូចដើមវិញរៀងរាល់យប់ នៅម៉ោង {reset}:00។',
  'demo.admin': 'ចូលផ្ទាំងគ្រប់គ្រង',
  'demo.app': 'កម្មវិធីបុគ្គលិក៖ លេខកូដក្រុមហ៊ុន / លេខសម្គាល់បុគ្គលិក',
  'demo.password': 'ពាក្យសម្ងាត់',
  'demo.openAdmin': 'បើកផ្ទាំងគ្រប់គ្រងសាកល្បង',
  'demo.openApp': 'បើកកម្មវិធីបុគ្គលិក',
  'contact.phone': 'ទូរស័ព្ទ',
  'contact.telegram': 'តេឡេក្រាម',
  'contact.email': 'អ៊ីមែល',
  'footer.rights': '© {year} MySoft KH។ រក្សាសិទ្ធិគ្រប់យ៉ាង។',
  'footer.terms': 'លក្ខខណ្ឌ និងឯកជនភាព',
  'footer.refund': 'ការលុបចោល និងសងប្រាក់វិញ',
  'refund.download': 'ទាញយកជាឯកសារ Word (.docx)',

  'signup.title': 'បង្កើតគណនីឥតគិតថ្លៃ',
  'signup.sub': 'សាកល្បងឥតគិតថ្លៃ {months} ខែ។ មិនចាំបាច់ប្រើកាត។',
  'signup.companyName': 'ឈ្មោះក្រុមហ៊ុន',
  'signup.companyCode': 'លេខកូដក្រុមហ៊ុន',
  'signup.codeHint': 'បុគ្គលិកវាយលេខកូដនេះពេលចូលគណនី។ អក្សរឡាតាំង និងលេខ។',
  'signup.codeTaken': 'មានគេប្រើរួចហើយ សូមជ្រើសរើសផ្សេង',
  'signup.codeFree': 'អាចប្រើបាន',
  'signup.fullName': 'ឈ្មោះរបស់អ្នក',
  'signup.email': 'អ៊ីមែល',
  'signup.phone': 'លេខទូរស័ព្ទ',
  'signup.password': 'ពាក្យសម្ងាត់',
  'signup.passwordHint': 'យ៉ាងតិច ៨ តួ មានទាំងអក្សរ និងលេខ។',
  'signup.staff': 'ចំនួនបុគ្គលិក',
  'signup.terms': 'ខ្ញុំយល់ព្រមលើ',
  'signup.termsLink': 'លក្ខខណ្ឌប្រើប្រាស់',
  'signup.submit': 'បង្កើតគណនី',
  'signup.busy': 'កំពុងបង្កើតគណនី…',
  'signup.have': 'មានគណនីរួចហើយ?',
  'signup.after': 'ឥតគិតថ្លៃរហូតដល់ {date} បន្ទាប់មក {price} ក្នុងមួយខែ សម្រាប់បុគ្គលិក {min}–{max} នាក់។',
  'signup.why1': 'ឥតគិតថ្លៃ {period} ប្រើមុខងារទាំងអស់',
  'signup.why2': 'លេខកូដក្រុមហ៊ុន និងគណនីអ្នកគ្រប់គ្រងផ្ទាល់ខ្លួន',
  'signup.why3': 'ជំនួយជាភាសាខ្មែរ និងអង់គ្លេស',

  'terms.title': 'លក្ខខណ្ឌប្រើប្រាស់ និងឯកជនភាព',
};

const DICT: Record<Lang, Record<Key, string>> = { en, km };
const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩';
const STORE = 'qra.lang';

function initial(): Lang {
  // ?lang=km from the website on another address
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked === 'en' || asked === 'km') {
    try {
      localStorage.setItem(STORE, asked);
    } catch {
      /* storage unavailable */
    }
    return asked;
  }
  try {
    const saved = localStorage.getItem(STORE);
    if (saved === 'en' || saved === 'km') return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language?.toLowerCase().startsWith('km') ? 'km' : 'en';
}

const listeners = new Set<(l: Lang) => void>();
let current: Lang = typeof window === 'undefined' ? 'en' : initial();

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(STORE, l);
  } catch {
    /* storage unavailable */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f(l));
}

/** Khmer digits for small numbers in running text (prices and dates stay in Latin digits). */
export const khmerNumber = (n: number | string) => String(n).replace(/[0-9]/g, (d) => KHMER_DIGITS[Number(d)]);

export function useLang() {
  const [lang, set] = useState<Lang>(current);
  useEffect(() => {
    listeners.add(set);
    document.documentElement.lang = current;
    return () => {
      listeners.delete(set);
    };
  }, []);
  const t = (key: Key, vars: Record<string, string | number> = {}) =>
    DICT[lang][key].replace(/\{(\w+)\}/g, (_, k) => {
      const v = vars[k];
      if (v === undefined) return '';
      return lang === 'km' && typeof v === 'number' ? khmerNumber(v) : String(v);
    });
  /** "1 month" / "3 months" / "៣ ខែ". */
  const period = (months: number) => (lang === 'km' ? `${khmerNumber(months)} ខែ` : `${months} month${months === 1 ? '' : 's'}`);
  return { lang, t, setLang, period };
}
