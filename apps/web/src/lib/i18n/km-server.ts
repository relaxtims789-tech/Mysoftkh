// Khmer for messages that come from the API (apps/api/src), shown with tServer().
// Digits in a message are replaced by "#" before the lookup, so "Choose a range of at most 400 days." uses the key
// "Choose a range of at most # days." and the numbers are put back in the same order.
export default {
  // ---------- common (errors.ts, auth.ts, http-exception.filter.ts) ----------
  'Please sign in again.': 'សូមចូលគណនីម្តងទៀត។',
  'You do not have permission to do this.': 'អ្នកមិនមានសិទ្ធិធ្វើការនេះទេ។',
  'Record not found.': 'រកមិនឃើញកំណត់ត្រាទេ។',
  'Not found.': 'រកមិនឃើញទេ។',
  'Your session has expired. Please sign in again.': 'វគ្គប្រើប្រាស់របស់អ្នកបានផុតកំណត់។ សូមចូលគណនីម្តងទៀត។',
  'Your session has ended. Please sign in again.': 'វគ្គប្រើប្រាស់របស់អ្នកបានបញ្ចប់។ សូមចូលគណនីម្តងទៀត។',
  'Please sign in.': 'សូមចូលគណនី។',
  'Your account is disabled.': 'គណនីរបស់អ្នកត្រូវបានបិទ។',
  'Your account is disabled. Contact your administrator.': 'គណនីរបស់អ្នកត្រូវបានបិទ។ សូមទាក់ទងអ្នកគ្រប់គ្រងរបស់អ្នក។',
  'Your company account is suspended.': 'គណនីក្រុមហ៊ុនរបស់អ្នកត្រូវបានផ្អាក។',
  'Your employee record is inactive.': 'ព័ត៌មានបុគ្គលិករបស់អ្នកមិនសកម្មទេ។',
  'Your employee record is inactive. Contact HR.': 'ព័ត៌មានបុគ្គលិករបស់អ្នកមិនសកម្មទេ។ សូមទាក់ទងធនធានមនុស្ស (HR)។',
  'Your subscription has ended. Renew it in Billing to continue (you can still view and export your data).':
    'ការជាវរបស់អ្នកបានផុតកំណត់។ សូមបន្តការជាវនៅក្នុងផ្នែកវិក្កយបត្រ ដើម្បីបន្តប្រើ (អ្នកនៅតែអាចមើល និងនាំចេញទិន្នន័យបាន)។',
  "Your company's subscription has ended. Ask your administrator to renew it.": 'ការជាវរបស់ក្រុមហ៊ុនអ្នកបានផុតកំណត់។ សូមស្នើអ្នកគ្រប់គ្រងរបស់អ្នកឱ្យបន្តការជាវ។',
  'Unknown company.': 'មិនស្គាល់ក្រុមហ៊ុននេះទេ។',
  'Please change your temporary password first.': 'សូមប្តូរពាក្យសម្ងាត់បណ្តោះអាសន្នរបស់អ្នកជាមុនសិន។',
  'Select a company first.': 'សូមជ្រើសរើសក្រុមហ៊ុនជាមុនសិន។',
  'This account is not linked to an employee.': 'គណនីនេះមិនបានភ្ជាប់ជាមួយបុគ្គលិកណាម្នាក់ទេ។',
  'Something went wrong. Please try again.': 'មានបញ្ហាអ្វីមួយកើតឡើង។ សូមព្យាយាមម្តងទៀត។',
  'Too many requests. Please wait a moment and try again.': 'មានសំណើច្រើនពេក។ សូមរង់ចាំបន្តិច ហើយព្យាយាមម្តងទៀត។',
  'The request body is not valid JSON.': 'ទិន្នន័យដែលបានផ្ញើមិនមែនជា JSON ត្រឹមត្រូវទេ។',

  // ---------- scan rules (domain/punch-rules.ts) ----------
  'You already checked in today at #:#.': 'អ្នកបានចុះវត្តមានចូលរួចហើយនៅថ្ងៃនេះ នៅម៉ោង #:#។',
  'You already checked out today at #:#.': 'អ្នកបានចុះវត្តមានចេញរួចហើយនៅថ្ងៃនេះ នៅម៉ោង #:#។',
  'Lunch-out was already recorded at #:#.': 'ការចេញសម្រាកថ្ងៃត្រង់បានកត់ត្រារួចហើយ នៅម៉ោង #:#។',
  'Lunch-in was already recorded at #:#.': 'ការចូលវិញក្រោយសម្រាកបានកត់ត្រារួចហើយ នៅម៉ោង #:#។',
  'Lunch scans are not used by your company.': 'ក្រុមហ៊ុនរបស់អ្នកមិនប្រើការស្កេនពេលសម្រាកថ្ងៃត្រង់ទេ។',
  'Please check in first.': 'សូមចុះវត្តមានចូលជាមុនសិន។',
  'Lunch-out was not recorded.': 'មិនទាន់បានកត់ត្រាការចេញសម្រាកថ្ងៃត្រង់ទេ។',

  // ---------- attendance (modules/attendance) ----------
  'Invalid device.': 'ឧបករណ៍មិនត្រឹមត្រូវ។',
  'Invalid signature.': 'ហត្ថលេខាឌីជីថលមិនត្រឹមត្រូវ។',
  'ON TIME': 'ទាន់ម៉ោង',
  'LATE': 'យឺត',
  'EARLY LEAVE': 'ចេញមុនម៉ោង',
  'OVERTIME': 'ម៉ោងបន្ថែម',
  'DAY OFF': 'ថ្ងៃឈប់',
  'The scan type does not match this action.': 'ប្រភេទការស្កេនមិនត្រូវនឹងសកម្មភាពនេះទេ។',
  'Your location is needed to record attendance. Turn on location and allow access, then try again.':
    'ត្រូវការទីតាំងរបស់អ្នកដើម្បីកត់ត្រាវត្តមាន។ សូមបើកទីតាំង (GPS) ហើយអនុញ្ញាតឱ្យប្រើ រួចព្យាយាមម្តងទៀត។',
  'Your GPS signal is too weak (±# m). Move near a window or outside and try again.':
    'សញ្ញា GPS របស់អ្នកខ្សោយពេក (±# m)។ សូមទៅជិតបង្អួច ឬចេញទៅខាងក្រៅ ហើយព្យាយាមម្តងទៀត។',
  'Your GPS signal is too weak. Move near a window or outside and try again.':
    'សញ្ញា GPS របស់អ្នកខ្សោយពេក។ សូមទៅជិតបង្អួច ឬចេញទៅខាងក្រៅ ហើយព្យាយាមម្តងទៀត។',
  'This is not an attendance QR code.': 'នេះមិនមែនជាកូដ QR សម្រាប់ចុះវត្តមានទេ។',
  'This QR code is not valid for your company.': 'កូដ QR នេះមិនត្រឹមត្រូវសម្រាប់ក្រុមហ៊ុនរបស់អ្នកទេ។',
  'This QR code has been disabled. Please scan the current QR code at the entrance.': 'កូដ QR នេះត្រូវបានបិទ។ សូមស្កេនកូដ QR បច្ចុប្បន្ននៅច្រកចូល។',
  'Your location is outside the allowed attendance area.': 'ទីតាំងរបស់អ្នកស្ថិតនៅក្រៅតំបន់ដែលអនុញ្ញាតឱ្យចុះវត្តមាន។',
  'Check-in without scanning is turned off by your company. Please scan the QR code at the entrance.':
    'ក្រុមហ៊ុនរបស់អ្នកបានបិទការចុះវត្តមានចូលដោយមិនស្កេន។ សូមស្កេនកូដ QR នៅច្រកចូល។',
  'This phone is not registered for attendance.': 'ទូរស័ព្ទនេះមិនទាន់បានចុះឈ្មោះសម្រាប់ចុះវត្តមានទេ។',
  'This phone is not registered for attendance. Register it from your profile, or use your registered phone.':
    'ទូរស័ព្ទនេះមិនទាន់បានចុះឈ្មោះសម្រាប់ចុះវត្តមានទេ។ សូមចុះឈ្មោះវាពីប្រវត្តិរូបរបស់អ្នក ឬប្រើទូរស័ព្ទដែលបានចុះឈ្មោះរបស់អ្នក។',
  'This phone is not allowed.': 'ទូរស័ព្ទនេះមិនត្រូវបានអនុញ្ញាតទេ។',
  'Device verification failed. Please try again from your registered phone.': 'ការផ្ទៀងផ្ទាត់ឧបករណ៍បានបរាជ័យ។ សូមព្យាយាមម្តងទៀតពីទូរស័ព្ទដែលបានចុះឈ្មោះរបស់អ្នក។',
  'Attendance already recorded.': 'វត្តមានបានកត់ត្រារួចហើយ។',
  'Your work ends at #:#. Check out now?': 'ការងាររបស់អ្នកបញ្ចប់នៅម៉ោង #:#។ ចុះវត្តមានចេញឥឡូវនេះ?',
  'Check-in recorded at #:#': 'បានកត់ត្រាការចុះវត្តមានចូល នៅម៉ោង #:#',
  'Lunch-out recorded at #:#': 'បានកត់ត្រាការចេញសម្រាកថ្ងៃត្រង់ នៅម៉ោង #:#',
  'Lunch-in recorded at #:#': 'បានកត់ត្រាការចូលវិញក្រោយសម្រាក នៅម៉ោង #:#',
  'Check-out recorded at #:#': 'បានកត់ត្រាការចុះវត្តមានចេញ នៅម៉ោង #:#',
  '"From" must be before "to".': 'កាលបរិច្ឆេទ "ចាប់ពី" ត្រូវតែមុនកាលបរិច្ឆេទ "ដល់"។',
  '"From" must be on or before "to".': 'កាលបរិច្ឆេទ "ចាប់ពី" ត្រូវតែដូចគ្នា ឬមុនកាលបរិច្ឆេទ "ដល់"។',
  'Choose a range of at most # days.': 'សូមជ្រើសរើសចន្លោះពេលយ៉ាងច្រើន # ថ្ងៃ។',
  'Choose a range of at most one year.': 'សូមជ្រើសរើសចន្លោះពេលយ៉ាងច្រើនមួយឆ្នាំ។',
  'This record is already void.': 'កំណត់ត្រានេះត្រូវបានលុបចោលរួចហើយ។',

  // ---------- "... not found." ----------
  'Employee not found.': 'រកមិនឃើញបុគ្គលិកទេ។',
  'Attendance record not found.': 'រកមិនឃើញកំណត់ត្រាវត្តមានទេ។',
  'Company not found.': 'រកមិនឃើញក្រុមហ៊ុនទេ។',
  'Invoice not found.': 'រកមិនឃើញវិក្កយបត្រទេ។',
  'Receipt not found.': 'រកមិនឃើញបង្កាន់ដៃទេ។',
  'Correction request not found.': 'រកមិនឃើញសំណើកែតម្រូវទេ។',
  'Device not found.': 'រកមិនឃើញឧបករណ៍ទេ។',
  'Login not found.': 'រកមិនឃើញគណនីចូលប្រើទេ។',
  'API key not found.': 'រកមិនឃើញ API key ទេ។',
  'Leave request not found.': 'រកមិនឃើញសំណើច្បាប់ទេ។',
  'Branch not found.': 'រកមិនឃើញសាខាទេ។',
  'Department not found.': 'រកមិនឃើញនាយកដ្ឋានទេ។',
  'Position not found.': 'រកមិនឃើញតួនាទីទេ។',
  'Schedule not found.': 'រកមិនឃើញកាលវិភាគការងារទេ។',
  'Holiday not found.': 'រកមិនឃើញថ្ងៃឈប់សម្រាកបុណ្យទេ។',
  'Payroll for that month not found.': 'រកមិនឃើញប្រាក់បៀវត្សសម្រាប់ខែនោះទេ។',
  'Pay item not found.': 'រកមិនឃើញធាតុប្រាក់ខែទេ។',
  'Allowance not found.': 'រកមិនឃើញប្រាក់ឧបត្ថម្ភទេ។',
  'Payslip not found.': 'រកមិនឃើញប័ណ្ណប្រាក់ខែទេ។',
  'QR code not found.': 'រកមិនឃើញកូដ QR ទេ។',
  'Telegram group not found.': 'រកមិនឃើញក្រុម Telegram ទេ។',
  'User not found.': 'រកមិនឃើញអ្នកប្រើប្រាស់ទេ។',

  // ---------- sign-in, password (modules/auth) ----------
  'Password must be at least # characters and contain a letter and a number.': 'ពាក្យសម្ងាត់ត្រូវមានយ៉ាងតិច # តួអក្សរ ហើយមានអក្សរ និងលេខ។',
  'Incorrect company code, employee ID / phone number or password.': 'លេខកូដក្រុមហ៊ុន លេខសម្គាល់បុគ្គលិក / លេខទូរស័ព្ទ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។',
  'Incorrect email / phone number or password.': 'អ៊ីមែល / លេខទូរស័ព្ទ ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។',
  'Too many failed attempts. Try again after # minutes.': 'បានព្យាយាមខុសច្រើនដងពេក។ សូមព្យាយាមម្តងទៀតក្រោយ # នាទី។',
  'Your current password is incorrect.': 'ពាក្យសម្ងាត់បច្ចុប្បន្នរបស់អ្នកមិនត្រឹមត្រូវ។',
  'Choose a password different from the current one.': 'សូមជ្រើសរើសពាក្យសម្ងាត់ផ្សេងពីពាក្យសម្ងាត់បច្ចុប្បន្ន។',

  // ---------- billing, sign-up (modules/billing, core/company-context) ----------
  'Company code must be #-# letters, numbers, - or _.': 'លេខកូដក្រុមហ៊ុនត្រូវមានពី # ដល់ # តួ ដែលជាអក្សរ លេខ - ឬ _។',
  'Email is not valid.': 'អ៊ីមែលមិនត្រឹមត្រូវ។',
  'Please accept the terms.': 'សូមយល់ព្រមលើលក្ខខណ្ឌ។',
  'Give a code or a name.': 'សូមផ្តល់លេខកូដ ឬឈ្មោះ។',
  'Sign-up failed.': 'ការចុះឈ្មោះបានបរាជ័យ។',
  'Phone number is not valid.': 'លេខទូរស័ព្ទមិនត្រឹមត្រូវ។',
  'Must be aba, acleda or telegram.': 'ត្រូវតែជា aba, acleda ឬ telegram។',
  'Enter the PayWay merchant ID and API key first.': 'សូមបញ្ចូល merchant ID និង API key របស់ PayWay ជាមុនសិន។',
  'PayWay accepted the merchant ID and API key.': 'PayWay បានទទួលយក merchant ID និង API key។',
  '"#-#": from must be ≤ to.': '"#-#"៖ ចំនួនចាប់ពី ត្រូវតែ ≤ ចំនួនដល់។',
  'Staff ranges overlap at #.': 'ចន្លោះចំនួនបុគ្គលិកជាន់គ្នានៅ #។',
  'Your plan is paid. To get more staff, upgrade it with an upgrade invoice.': 'គម្រោងរបស់អ្នកត្រូវបានបង់ប្រាក់រួចហើយ។ ដើម្បីបន្ថែមបុគ្គលិក សូមដំឡើងគម្រោងដោយវិក្កយបត្រដំឡើង។',
  'You have # active staff; choose a plan for at least #.': 'អ្នកមានបុគ្គលិកសកម្ម # នាក់ សូមជ្រើសគម្រោងសម្រាប់យ៉ាងតិច # នាក់។',
  'You have # active branches; this plan allows #. Choose a bigger plan or turn off branches first.':
    'អ្នកមានសាខាសកម្ម # គម្រោងនេះអនុញ្ញាតតែ #។ សូមជ្រើសគម្រោងធំជាងនេះ ឬបិទសាខាខ្លះជាមុនសិន។',
  'That plan is not available.': 'គម្រោងនោះមិនមានទេ។',
  'This company is on a free plan and does not need to pay.': 'ក្រុមហ៊ុននេះប្រើគម្រោងឥតគិតថ្លៃ ហើយមិនចាំបាច់បង់ប្រាក់ទេ។',
  'Only unpaid invoices can be cancelled.': 'អាចលុបចោលបានតែវិក្កយបត្រដែលមិនទាន់បង់ប្រាក់ប៉ុណ្ណោះ។',
  'Please read and accept the Cancellation & Refund Policy before paying.': 'សូមអាន និងយល់ព្រមលើគោលការណ៍លុបចោល និងសងប្រាក់វិញ មុនពេលបង់ប្រាក់។',
  'Online payment is not available yet. Please pay by bank transfer.': 'ការបង់ប្រាក់តាមអនឡាញមិនទាន់មាននៅឡើយទេ។ សូមបង់ប្រាក់តាមការផ្ទេរប្រាក់តាមធនាគារ។',
  'This invoice is not waiting for payment.': 'វិក្កយបត្រនេះមិនកំពុងរង់ចាំការបង់ប្រាក់ទេ។',
  'Attach a photo or PDF of the transfer receipt.': 'សូមភ្ជាប់រូបថត ឬ PDF នៃបង្កាន់ដៃផ្ទេរប្រាក់។',
  'The receipt is larger than # MB.': 'បង្កាន់ដៃមានទំហំធំជាង # MB។',
  'The receipt must be a PNG, JPEG, WebP image or a PDF.': 'បង្កាន់ដៃត្រូវតែជារូបភាព PNG, JPEG, WebP ឬ PDF។',
  'This invoice was cancelled.': 'វិក្កយបត្រនេះត្រូវបានលុបចោល។',
  'Only submitted transfers can be rejected.': 'អាចបដិសេធបានតែការផ្ទេរប្រាក់ដែលបានដាក់ស្នើប៉ុណ្ណោះ។',
  'That company code is already used. Choose another one.': 'លេខកូដក្រុមហ៊ុននោះត្រូវបានប្រើរួចហើយ។ សូមជ្រើសរើសលេខកូដផ្សេង។',
  'An account with this email already exists. Sign in instead.': 'មានគណនីដែលប្រើអ៊ីមែលនេះរួចហើយ។ សូមចូលគណនីជំនួសវិញ។',
  'An account with this phone number already exists. Sign in instead.': 'មានគណនីដែលប្រើលេខទូរស័ព្ទនេះរួចហើយ។ សូមចូលគណនីជំនួសវិញ។',
  'That company code or email is already used.': 'លេខកូដក្រុមហ៊ុន ឬអ៊ីមែលនោះត្រូវបានប្រើរួចហើយ។',
  'Enter the Telegram bot token and chat ID first.': 'សូមបញ្ចូល bot token និង chat ID របស់ Telegram ជាមុនសិន។',
  'Payroll for #-# is approved and locked. A company admin must unlock it first.': 'ប្រាក់បៀវត្សខែ #-# បានអនុម័ត និងបានចាក់សោ។ អ្នកគ្រប់គ្រងក្រុមហ៊ុនត្រូវដោះសោវាជាមុនសិន។',
  'Payroll for #-# is paid and locked. A company admin must unlock it first.': 'ប្រាក់បៀវត្សខែ #-# បានបើកប្រាក់ និងបានចាក់សោ។ អ្នកគ្រប់គ្រងក្រុមហ៊ុនត្រូវដោះសោវាជាមុនសិន។',
  'Your plan allows # active branch (you have #). Choose a bigger plan in Billing & plan, or ask us for more.':
    'គម្រោងរបស់អ្នកអនុញ្ញាតសាខាសកម្ម # (អ្នកមាន #)។ សូមជ្រើសគម្រោងធំជាងនេះនៅក្នុងផ្នែកវិក្កយបត្រ និងគម្រោង ឬស្នើសុំបន្ថែមពីយើង។',
  'Your plan allows # active branches (you have #). Choose a bigger plan in Billing & plan, or ask us for more.':
    'គម្រោងរបស់អ្នកអនុញ្ញាតសាខាសកម្ម # (អ្នកមាន #)។ សូមជ្រើសគម្រោងធំជាងនេះនៅក្នុងផ្នែកវិក្កយបត្រ និងគម្រោង ឬស្នើសុំបន្ថែមពីយើង។',
  'Your plan covers up to # active staff (you have #). Choose a bigger plan in Billing.':
    'គម្រោងរបស់អ្នកគ្របដណ្តប់បុគ្គលិកសកម្មរហូតដល់ # នាក់ (អ្នកមាន # នាក់)។ សូមជ្រើសគម្រោងធំជាងនេះនៅក្នុងផ្នែកវិក្កយបត្រ។',

  // ---------- corrections ----------
  'Date must be YYYY-MM-DD': 'កាលបរិច្ឆេទត្រូវមានទម្រង់ YYYY-MM-DD',
  'Date must be YYYY-MM-DD.': 'កាលបរិច្ឆេទត្រូវមានទម្រង់ YYYY-MM-DD។',
  'Time must be HH:MM': 'ម៉ោងត្រូវមានទម្រង់ HH:MM',
  'Time must be HH:MM.': 'ម៉ោងត្រូវមានទម្រង់ HH:MM។',
  'Please give a reason.': 'សូមផ្តល់មូលហេតុ។',
  'That date is not valid.': 'កាលបរិច្ឆេទនោះមិនត្រឹមត្រូវ។',
  'Choose an employee.': 'សូមជ្រើសរើសបុគ្គលិក។',
  'Correction requests are turned off. Contact HR.': 'សំណើកែតម្រូវត្រូវបានបិទ។ សូមទាក់ទងធនធានមនុស្ស (HR)។',
  'You cannot request a correction for a future date.': 'អ្នកមិនអាចស្នើការកែតម្រូវសម្រាប់ថ្ងៃខាងមុខបានទេ។',
  'That time is in the future.': 'ម៉ោងនោះស្ថិតនៅពេលខាងមុខ។',
  'There is already a pending request for that day and type.': 'មានសំណើកំពុងរង់ចាំសម្រាប់ថ្ងៃ និងប្រភេទនោះរួចហើយ។',
  'This request was already handled.': 'សំណើនេះត្រូវបានដោះស្រាយរួចហើយ។',
  'Only your own pending requests can be cancelled.': 'អាចលុបចោលបានតែសំណើរបស់អ្នកផ្ទាល់ដែលកំពុងរង់ចាំប៉ុណ្ណោះ។',

  // ---------- phones (modules/devices) ----------
  'This phone is registered for attendance.': 'ទូរស័ព្ទនេះបានចុះឈ្មោះសម្រាប់ចុះវត្តមានហើយ។',
  'This phone is waiting for administrator approval. You can scan once it is approved.': 'ទូរស័ព្ទនេះកំពុងរង់ចាំការអនុម័តពីអ្នកគ្រប់គ្រង។ អ្នកអាចស្កេនបានបន្ទាប់ពីវាត្រូវបានអនុម័ត។',
  'This phone was rejected by your administrator. Use your registered phone or contact HR.': 'ទូរស័ព្ទនេះត្រូវបានបដិសេធដោយអ្នកគ្រប់គ្រងរបស់អ្នក។ សូមប្រើទូរស័ព្ទដែលបានចុះឈ្មោះរបស់អ្នក ឬទាក់ទងធនធានមនុស្ស (HR)។',
  'This phone is no longer registered. Contact HR to register it again.': 'ទូរស័ព្ទនេះលែងបានចុះឈ្មោះទៀតហើយ។ សូមទាក់ទងធនធានមនុស្ស (HR) ដើម្បីចុះឈ្មោះវាម្តងទៀត។',
  'This phone is not registered yet.': 'ទូរស័ព្ទនេះមិនទាន់បានចុះឈ្មោះនៅឡើយទេ។',
  'This browser could not create a device key.': 'កម្មវិធីរុករកនេះមិនអាចបង្កើតសោឧបករណ៍បានទេ។',
  'Device verification failed.': 'ការផ្ទៀងផ្ទាត់ឧបករណ៍បានបរាជ័យ។',
  'The request is invalid. Please try again.': 'សំណើមិនត្រឹមត្រូវ។ សូមព្យាយាមម្តងទៀត។',
  'The request took too long. Please scan again.': 'សំណើចំណាយពេលយូរពេក។ សូមស្កេនម្តងទៀត។',
  'This request was already used. Please scan again.': 'សំណើនេះត្រូវបានប្រើរួចហើយ។ សូមស្កេនម្តងទៀត។',

  // ---------- employees ----------
  'Employee ID may contain letters, numbers, dot, - and _ (max #).': 'លេខសម្គាល់បុគ្គលិកអាចមានអក្សរ លេខ ចំណុច - និង _ (យ៉ាងច្រើន # តួ)។',
  'Hire date must be YYYY-MM-DD': 'ថ្ងៃចូលធ្វើការត្រូវមានទម្រង់ YYYY-MM-DD',
  'Salary must be a number.': 'ប្រាក់ខែត្រូវតែជាលេខ។',
  'Hourly rate must be a number.': 'អត្រាប្រាក់ម៉ោងត្រូវតែជាលេខ។',
  'Bank account may contain letters, numbers, spaces and - (max #).': 'លេខគណនីធនាគារអាចមានអក្សរ លេខ ដកឃ្លា និង - (យ៉ាងច្រើន # តួ)។',
  'An employee with that ID already exists.': 'មានបុគ្គលិកដែលប្រើលេខសម្គាល់នោះរួចហើយ។',
  'Name is required': 'ត្រូវការឈ្មោះ',
  'Fix the file and try again.': 'សូមកែឯកសារ ហើយព្យាយាមម្តងទៀត។',

  // ---------- integrations ----------
  'Missing or invalid API key.': 'គ្មាន API key ឬ API key មិនត្រឹមត្រូវ។',
  'Copy this key now. It is not shown again.': 'សូមចម្លងសោនេះឥឡូវនេះ។ វានឹងមិនបង្ហាញម្តងទៀតទេ។',

  // ---------- leave ----------
  'Start date must be YYYY-MM-DD': 'ថ្ងៃចាប់ផ្តើមត្រូវមានទម្រង់ YYYY-MM-DD',
  'End date must be YYYY-MM-DD': 'ថ្ងៃបញ្ចប់ត្រូវមានទម្រង់ YYYY-MM-DD',
  'Dates are not valid.': 'កាលបរិច្ឆេទមិនត្រឹមត្រូវ។',
  'End date must be on or after the start date.': 'ថ្ងៃបញ្ចប់ត្រូវតែដូចគ្នា ឬក្រោយថ្ងៃចាប់ផ្តើម។',
  'Leave can be at most # days per request.': 'ច្បាប់ឈប់សម្រាកអាចមានយ៉ាងច្រើន # ថ្ងៃក្នុងមួយសំណើ។',
  'A half day must start and end on the same date.': 'កន្លះថ្ងៃត្រូវចាប់ផ្តើម និងបញ្ចប់នៅថ្ងៃតែមួយ។',
  'You already have leave in that period.': 'អ្នកមានច្បាប់ឈប់សម្រាកក្នុងរយៈពេលនោះរួចហើយ។',
  'There are no working days in that period.': 'គ្មានថ្ងៃធ្វើការក្នុងរយៈពេលនោះទេ។',
  'You cannot approve your own leave.': 'អ្នកមិនអាចអនុម័តច្បាប់ឈប់សម្រាករបស់ខ្លួនឯងបានទេ។',

  // ---------- organization: company, branches, schedules, holidays ----------
  'Code must be #-# letters, numbers, - or _.': 'លេខកូដត្រូវមានពី # ដល់ # តួ ដែលជាអក្សរ លេខ - ឬ _។',
  'Radius must be a number with at most # decimals.': 'កាំត្រូវតែជាលេខដែលមានខ្ទង់ទសភាគយ៉ាងច្រើន # ខ្ទង់។',
  'Radius must be at least # m.': 'កាំត្រូវមានយ៉ាងតិច # m។',
  'Start time must be HH:MM': 'ម៉ោងចាប់ផ្តើមត្រូវមានទម្រង់ HH:MM',
  'End time must be HH:MM': 'ម៉ោងបញ្ចប់ត្រូវមានទម្រង់ HH:MM',
  'Lunch start must be HH:MM': 'ម៉ោងចាប់ផ្តើមសម្រាកថ្ងៃត្រង់ត្រូវមានទម្រង់ HH:MM',
  'Lunch end must be HH:MM': 'ម៉ោងបញ្ចប់សម្រាកថ្ងៃត្រង់ត្រូវមានទម្រង់ HH:MM',
  'Unknown time zone.': 'មិនស្គាល់តំបន់ម៉ោងនេះទេ។',
  'That company code or admin email is already used.': 'លេខកូដក្រុមហ៊ុន ឬអ៊ីមែលអ្នកគ្រប់គ្រងនោះត្រូវបានប្រើរួចហើយ។',
  'That company code is already used.': 'លេខកូដក្រុមហ៊ុននោះត្រូវបានប្រើរួចហើយ។',
  'A branch with that code already exists.': 'មានសាខាដែលប្រើលេខកូដនោះរួចហើយ។',
  'That name is already used.': 'ឈ្មោះនោះត្រូវបានប្រើរួចហើយ។',
  'End time must be after start time (overnight shifts are not supported yet).': 'ម៉ោងបញ្ចប់ត្រូវតែក្រោយម៉ោងចាប់ផ្តើម (វេនឆ្លងយប់មិនទាន់គាំទ្រនៅឡើយទេ)។',
  'Set both lunch start and lunch end, or neither.': 'សូមកំណត់ទាំងម៉ោងចាប់ផ្តើម និងម៉ោងបញ្ចប់សម្រាកថ្ងៃត្រង់ ឬកុំកំណត់ទាំងពីរ។',
  'Lunch must be inside working hours.': 'ម៉ោងសម្រាកថ្ងៃត្រង់ត្រូវស្ថិតក្នុងម៉ោងធ្វើការ។',
  'There is already a holiday on that date.': 'មានថ្ងៃឈប់សម្រាកបុណ្យនៅថ្ងៃនោះរួចហើយ។',

  // ---------- overtime ----------
  'A normal work day can be paid per hour only.': 'ថ្ងៃធ្វើការធម្មតាអាចបើកប្រាក់តាមម៉ោងតែប៉ុណ្ណោះ។',
  'No overtime found for that employee on #-#-#.': 'រកមិនឃើញម៉ោងបន្ថែម (OT) របស់បុគ្គលិកនោះនៅថ្ងៃ #-#-# ទេ។',
  'You cannot approve your own overtime.': 'អ្នកមិនអាចអនុម័តម៉ោងបន្ថែមរបស់ខ្លួនឯងបានទេ។',

  // ---------- payroll ----------
  'Month must be YYYY-MM.': 'ខែត្រូវមានទម្រង់ YYYY-MM។',
  'Format must be csv, xlsx or pdf.': 'ទម្រង់ឯកសារត្រូវតែជា csv, xlsx ឬ pdf។',
  'kind must be summary, bank or payslips.': 'ប្រភេទត្រូវតែជា summary, bank ឬ payslips។',
  'Bad id.': 'លេខសម្គាល់មិនត្រឹមត្រូវ។',
  'The last tax bracket must have no upper limit.': 'កម្រិតពន្ធចុងក្រោយត្រូវតែគ្មានដែនកំណត់ខាងលើ។',
  'Only the last tax bracket can be without an upper limit.': 'មានតែកម្រិតពន្ធចុងក្រោយប៉ុណ្ណោះដែលអាចគ្មានដែនកំណត់ខាងលើ។',
  'The NSSF minimum wage must be below the maximum.': 'ប្រាក់ឈ្នួលអប្បបរមា ប.ស.ស. ត្រូវតែទាបជាងអតិបរមា។',
  'Payroll for #-# was locked meanwhile.': 'ប្រាក់បៀវត្សខែ #-# ត្រូវបានចាក់សោក្នុងពេលនេះ។',
  'Payroll for #-# is already approved.': 'ប្រាក់បៀវត្សខែ #-# បានអនុម័តរួចហើយ។',
  'Payroll for #-# is already paid.': 'ប្រាក់បៀវត្សខែ #-# បានបើកប្រាក់រួចហើយ។',
  'Payroll for #-# is already locked.': 'ប្រាក់បៀវត្សខែ #-# បានចាក់សោរួចហើយ។',
  'There is nobody to pay this month.': 'គ្មាននរណាម្នាក់ត្រូវបើកប្រាក់ខែនេះទេ។',
  'Only an approved payroll can be marked as paid.': 'មានតែប្រាក់បៀវត្សដែលបានអនុម័តប៉ុណ្ណោះ ដែលអាចកំណត់ថាបានបើកប្រាក់។',
  'This payroll is not locked.': 'ប្រាក់បៀវត្សនេះមិនទាន់បានចាក់សោទេ។',
  'Only a draft payroll can be deleted.': 'អាចលុបបានតែប្រាក់បៀវត្សព្រាងប៉ុណ្ណោះ។',
  'The monthly repayment cannot be more than the advance.': 'ការសងប្រចាំខែមិនអាចលើសប្រាក់ខែបុរេប្រទានបានទេ។',
  'That advance is not active.': 'ប្រាក់ខែបុរេប្រទាននោះមិនសកម្មទេ។',

  // ---------- QR codes, reports ----------
  'This QR code is not valid.': 'កូដ QR នេះមិនត្រឹមត្រូវ។',
  'This QR code has been disabled. Use the current QR code at the entrance.': 'កូដ QR នេះត្រូវបានបិទ។ សូមប្រើកូដ QR បច្ចុប្បន្ននៅច្រកចូល។',
  'Unknown report.': 'មិនស្គាល់របាយការណ៍នេះទេ។',
  'Date is not valid.': 'កាលបរិច្ឆេទមិនត្រឹមត្រូវ។',

  // ---------- Telegram ----------
  'Telegram is not set up on this server yet. Ask MySoft to set up the bot.': 'Telegram មិនទាន់បានរៀបចំនៅលើម៉ាស៊ីនមេនេះនៅឡើយទេ។ សូមស្នើ MySoft ឱ្យរៀបចំ bot។',
  'Choose at least one kind of message, or remove the group.': 'សូមជ្រើសរើសប្រភេទសារយ៉ាងតិចមួយ ឬដកក្រុមនេះចេញ។',
  'That branch does not exist.': 'សាខានោះមិនមានទេ។',
  'Telegram is not set up yet.': 'Telegram មិនទាន់បានរៀបចំនៅឡើយទេ។',
  'Telegram is not set up yet. Ask your administrator.': 'Telegram មិនទាន់បានរៀបចំនៅឡើយទេ។ សូមសួរអ្នកគ្រប់គ្រងរបស់អ្នក។',
  'Please close and open the app again from the Telegram bot.': 'សូមបិទ ហើយបើកកម្មវិធីម្តងទៀតពី bot Telegram។',
  'This app is for admins, HR and managers.': 'កម្មវិធីនេះសម្រាប់អ្នកគ្រប់គ្រង ធនធានមនុស្ស (HR) និងប្រធានផ្នែក។',
  'Sign in once to connect your Telegram.': 'សូមចូលគណនីម្តង ដើម្បីភ្ជាប់ Telegram របស់អ្នក។',
  'Bad webhook secret.': 'webhook secret មិនត្រឹមត្រូវ។',
  'Enter and save the admin bot token first.': 'សូមបញ្ចូល និងរក្សាទុក bot token សម្រាប់អ្នកគ្រប់គ្រងជាមុនសិន។',
  'Enter and save the staff bot token first.': 'សូមបញ្ចូល និងរក្សាទុក bot token សម្រាប់បុគ្គលិកជាមុនសិន។',
  'Telegram Mini Apps need an https address. Set it up on the server, not on a local PC.': 'Telegram Mini Apps ត្រូវការអាសយដ្ឋាន https។ សូមរៀបចំវានៅលើម៉ាស៊ីនមេ មិនមែននៅលើកុំព្យូទ័រក្នុងស្រុកទេ។',
  'Use two different bots: one for staff and one for admins.': 'សូមប្រើ bot ពីរផ្សេងគ្នា៖ មួយសម្រាប់បុគ្គលិក និងមួយសម្រាប់អ្នកគ្រប់គ្រង។',

  // ---------- uploads ----------
  'Choose an image file.': 'សូមជ្រើសរើសឯកសាររូបភាព។',
  'The image is larger than # MB.': 'រូបភាពមានទំហំធំជាង # MB។',
  'Only PNG, JPEG or WebP images are allowed.': 'អនុញ្ញាតតែរូបភាព PNG, JPEG ឬ WebP ប៉ុណ្ណោះ។',

  // ---------- staff accounts (modules/users) ----------
  'That phone number is already used by another staff account.': 'លេខទូរស័ព្ទនោះត្រូវបានប្រើដោយគណនីបុគ្គលិកផ្សេងរួចហើយ។',
  'Phone number is not valid. Example: # # # or +# # # #.': 'លេខទូរស័ព្ទមិនត្រឹមត្រូវ។ ឧទាហរណ៍៖ # # # ឬ +# # # #។',
  'Only an administrator can create administrators.': 'មានតែអ្នកគ្រប់គ្រងប៉ុណ្ណោះដែលអាចបង្កើតអ្នកគ្រប់គ្រងបាន។',
  'Enter an email or a phone number (or both) for signing in.': 'សូមបញ្ចូលអ៊ីមែល ឬលេខទូរស័ព្ទ (ឬទាំងពីរ) សម្រាប់ចូលគណនី។',
  'That employee already has a staff account.': 'បុគ្គលិកនោះមានគណនីបុគ្គលិករួចហើយ។',
  'That email (or sign-in name) is already used.': 'អ៊ីមែល (ឬឈ្មោះចូលគណនី) នោះត្រូវបានប្រើរួចហើយ។',
  'You cannot disable yourself or change your own role.': 'អ្នកមិនអាចបិទគណនីខ្លួនឯង ឬប្តូរតួនាទីរបស់ខ្លួនឯងបានទេ។',
  'Only an administrator can change administrators.': 'មានតែអ្នកគ្រប់គ្រងប៉ុណ្ណោះដែលអាចកែប្រែអ្នកគ្រប់គ្រងបាន។',
  'Only accounts linked to an employee can become employee accounts.': 'មានតែគណនីដែលភ្ជាប់ជាមួយបុគ្គលិកប៉ុណ្ណោះ ដែលអាចក្លាយជាគណនីបុគ្គលិកបាន។',
  'Keep an email or a phone number for signing in.': 'សូមរក្សាអ៊ីមែល ឬលេខទូរស័ព្ទមួយសម្រាប់ចូលគណនី។',

  // ---------- public demo (modules/demo, with the default MAIN_SITE_URL) ----------
  'Passwords cannot be changed in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'មិនអាចប្តូរពាក្យសម្ងាត់នៅក្នុងកំណែបង្ហាញបានទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Telegram is not connected in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'Telegram មិនបានភ្ជាប់នៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Telegram groups are not connected in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'ក្រុម Telegram មិនបានភ្ជាប់នៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Company details are fixed in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'ព័ត៌មានក្រុមហ៊ុនមិនអាចកែប្រែបាននៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Attendance rules are fixed in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'ច្បាប់វត្តមានមិនអាចកែប្រែបាននៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Billing is not available in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'ផ្នែកវិក្កយបត្រមិនមាននៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Sign-up is not available in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'ការចុះឈ្មោះមិនមាននៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'API keys are not available in the demo. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'API keys មិនមាននៅក្នុងកំណែបង្ហាញទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'The shared demo sign-ins cannot be changed. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'គណនីចូលប្រើរួមរបស់កំណែបង្ហាញមិនអាចកែប្រែបានទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
  'Employee E# is the shared demo sign-in for the staff app and cannot be changed. This is the demo; sign up for your own free trial at https://www.mysoftkh.com':
    'បុគ្គលិក E# ជាគណនីចូលប្រើរួមសម្រាប់កម្មវិធីបុគ្គលិកក្នុងកំណែបង្ហាញ ហើយមិនអាចកែប្រែបានទេ។ នេះជាកំណែបង្ហាញ សូមចុះឈ្មោះសាកល្បងឥតគិតថ្លៃផ្ទាល់ខ្លួនរបស់អ្នកនៅ https://www.mysoftkh.com',
} as Record<string, string>;
