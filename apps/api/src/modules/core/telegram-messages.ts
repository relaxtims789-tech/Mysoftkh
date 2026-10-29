import { Bilingual, dayLabel, time12, TgButton } from './telegram.service';

/** Texts of the Telegram messages to staff, in English and Khmer. */

const KM_MONTHS = ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'];
const kmDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return `${d} ${KM_MONTHS[m - 1]} ${y}`;
};
const monthEn = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthKm = (month: string) => `${KM_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const TYPE: Record<string, Bilingual> = {
  check_in: { en: 'Checked in', km: 'ចុះវត្តមានចូល' },
  check_out: { en: 'Checked out', km: 'ចុះវត្តមានចេញ' },
  lunch_out: { en: 'Lunch out', km: 'ចេញសម្រាកថ្ងៃត្រង់' },
  lunch_in: { en: 'Back from lunch', km: 'ចូលវិញក្រោយសម្រាក' },
};
const TYPE_NOUN: Record<string, Bilingual> = {
  check_in: { en: 'check-in', km: 'ចុះវត្តមានចូល' },
  check_out: { en: 'check-out', km: 'ចុះវត្តមានចេញ' },
  lunch_out: { en: 'lunch-out', km: 'ចេញសម្រាក' },
  lunch_in: { en: 'lunch-in', km: 'ចូលវិញក្រោយសម្រាក' },
};
const LEAVE: Record<string, Bilingual> = {
  annual: { en: 'Annual leave', km: 'ច្បាប់ប្រចាំឆ្នាំ' },
  sick: { en: 'Sick leave', km: 'ច្បាប់ឈឺ' },
  personal: { en: 'Personal leave', km: 'ច្បាប់ផ្ទាល់ខ្លួន' },
  maternity: { en: 'Maternity leave', km: 'ច្បាប់មាតុភាព' },
  unpaid: { en: 'Unpaid leave', km: 'ច្បាប់គ្មានប្រាក់ខែ' },
  other: { en: 'Leave', km: 'ច្បាប់ឈប់សម្រាក' },
};

/** Messages to a company's Telegram group. */
export const groupMessages = {
  punch(p: { name: string; code: string; type: string; time: string; branch: string; status: string; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number }): Bilingual {
    const t = TYPE[p.type] ?? TYPE.check_in;
    const icon = p.type === 'check_out' ? '🔴' : '🟢';
    const extra: Bilingual =
      p.status === 'late' ? { en: ` · ⚠️ late ${p.lateMinutes} min`, km: ` · ⚠️ យឺត ${p.lateMinutes} នាទី` }
      : p.status === 'early_leave' ? { en: ` · ⚠️ left ${p.earlyMinutes} min early`, km: ` · ⚠️ ចេញមុនម៉ោង ${p.earlyMinutes} នាទី` }
      : p.overtimeMinutes > 0 ? { en: ` · ⏱ overtime ${p.overtimeMinutes} min`, km: ` · ⏱ ម៉ោងបន្ថែម ${p.overtimeMinutes} នាទី` }
      : p.type === 'check_in' ? { en: ' · on time', km: ' · ទាន់ម៉ោង' } : { en: '', km: '' };
    return {
      en: `${icon} ${p.name} (${p.code}) · ${t.en} ${time12(p.time)}
📍 ${p.branch}${extra.en}`,
      km: `${icon} ${p.name} (${p.code}) · ${t.km} ${time12(p.time)}
📍 ${p.branch}${extra.km}`,
    };
  },
  connected(company: string, events: string[]): Bilingual {
    const names: Record<string, Bilingual> = {
      check_in: { en: 'check-ins', km: 'ចុះវត្តមានចូល' }, check_out: { en: 'check-outs', km: 'ចុះវត្តមានចេញ' },
      leave: { en: 'leave requests', km: 'សំណើច្បាប់' }, correction: { en: 'fix-scan requests', km: 'សំណើកែការស្កេន' },
    };
    const list = (l: 'en' | 'km') => events.map((e) => names[e]?.[l] ?? e).join(l === 'en' ? ', ' : ' · ');
    return {
      en: `✅ This group is now connected to ${company} (MySoft Attendance).
It will receive: ${list('en')}.`,
      km: `✅ ក្រុមនេះបានភ្ជាប់ជាមួយ ${company} (MySoft Attendance) ហើយ។
នឹងទទួលបាន៖ ${list('km')}។`,
    };
  },
  test(company: string): Bilingual {
    return { en: `🔔 Test message from MySoft Attendance for ${company}. Group alerts work.`, km: `🔔 សារសាកល្បងពី MySoft Attendance សម្រាប់ ${company}។ ការជូនដំណឹងក្នុងក្រុមដំណើរការ។` };
  },
};

export const REVIEW_LEAVE = { text: { en: '📋 Review', km: '📋 ពិនិត្យ' }, path: '/admin/leave' };
export const REVIEW_CORRECTION = { text: { en: '📋 Review', km: '📋 ពិនិត្យ' }, path: '/admin/corrections' };
export const LIVE_LINK = { text: { en: '👀 Live attendance', km: '👀 វត្តមានផ្ទាល់' }, path: '/admin/live' };

export const OPEN_APP: TgButton = { text: { en: '📲 Open attendance', km: '📲 បើកកម្មវិធីវត្តមាន' }, path: '/app' };

const note = (n?: string | null): Bilingual => (n?.trim() ? { en: `\nNote: ${n.trim()}`, km: `\nចំណាំ៖ ${n.trim()}` } : { en: '', km: '' });

export const tgMessages = {
  punch(p: { type: string; time: string; branch: string; status: string; lateMinutes: number; earlyMinutes: number; overtimeMinutes: number }): Bilingual {
    const t = TYPE[p.type] ?? TYPE.check_in;
    const extra: Bilingual =
      p.status === 'late' ? { en: `\n⚠️ Late ${p.lateMinutes} min`, km: `\n⚠️ យឺត ${p.lateMinutes} នាទី` }
      : p.status === 'early_leave' ? { en: `\n⚠️ Early leave ${p.earlyMinutes} min`, km: `\n⚠️ ចេញមុនម៉ោង ${p.earlyMinutes} នាទី` }
      : p.overtimeMinutes > 0 ? { en: `\n⏱ Overtime ${p.overtimeMinutes} min`, km: `\n⏱ ម៉ោងបន្ថែម ${p.overtimeMinutes} នាទី` }
      : { en: '', km: '' };
    return {
      en: `✅ ${t.en} at ${time12(p.time)}\n📍 ${p.branch}${extra.en}`,
      km: `✅ ${t.km} ម៉ោង ${time12(p.time)}\n📍 ${p.branch}${extra.km}`,
    };
  },

  leave(decision: 'approve' | 'reject', type: string, start: string, end: string, reviewNote?: string | null): Bilingual {
    const l = LEAVE[type] ?? LEAVE.other;
    const enDates = start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`;
    const kmDates = start === end ? kmDate(start) : `${kmDate(start)} ដល់ ${kmDate(end)}`;
    const n = note(reviewNote);
    return decision === 'approve'
      ? { en: `✅ Your ${l.en.toLowerCase()} (${enDates}) was approved.${n.en}`, km: `✅ ${l.km} (${kmDates}) របស់អ្នកត្រូវបានអនុម័ត។${n.km}` }
      : { en: `❌ Your ${l.en.toLowerCase()} (${enDates}) was not approved.${n.en}`, km: `❌ ${l.km} (${kmDates}) របស់អ្នកមិនត្រូវបានអនុម័តទេ។${n.km}` };
  },

  correction(decision: 'approve' | 'reject', date: string, type: string, reviewNote?: string | null): Bilingual {
    const t = TYPE_NOUN[type] ?? TYPE_NOUN.check_in;
    const n = note(reviewNote);
    return decision === 'approve'
      ? { en: `🛠 Your ${t.en} correction for ${dayLabel(date)} was approved.${n.en}`, km: `🛠 សំណើកែ${t.km} ថ្ងៃ ${kmDate(date)} ត្រូវបានអនុម័ត។${n.km}` }
      : { en: `❌ Your ${t.en} correction for ${dayLabel(date)} was not approved.${n.en}`, km: `❌ សំណើកែ${t.km} ថ្ងៃ ${kmDate(date)} មិនត្រូវបានអនុម័តទេ។${n.km}` };
  },

  overtime(decision: 'approve' | 'reject', date: string, minutes: number, reviewNote?: string | null): Bilingual {
    const n = note(reviewNote);
    return decision === 'approve'
      ? { en: `⏱ Overtime on ${dayLabel(date)}: ${minutes} min approved.${n.en}`, km: `⏱ ម៉ោងបន្ថែមថ្ងៃ ${kmDate(date)}៖ បានអនុម័ត ${minutes} នាទី។${n.km}` }
      : { en: `❌ Overtime on ${dayLabel(date)} was not approved.${n.en}`, km: `❌ ម៉ោងបន្ថែមថ្ងៃ ${kmDate(date)} មិនត្រូវបានអនុម័តទេ។${n.km}` };
  },

  device(decision: 'approve' | 'reject' | 'revoke', name: string | null): Bilingual {
    const phone = name ? ` (${name})` : '';
    if (decision === 'approve') return { en: `📱 Your phone${phone} was approved. You can check in now.`, km: `📱 ទូរស័ព្ទរបស់អ្នក${phone} ត្រូវបានអនុម័ត។ ឥឡូវអ្នកអាចចុះវត្តមានបានហើយ។` };
    return { en: `📱 Your phone${phone} cannot be used for attendance. Please contact HR.`, km: `📱 ទូរស័ព្ទរបស់អ្នក${phone} មិនអាចប្រើចុះវត្តមានបានទេ។ សូមទាក់ទង HR។` };
  },

  payslip(month: string, net: number, currency: string): Bilingual {
    const amount = currency === 'KHR' ? `${Math.round(net).toLocaleString('en-US')} ៛` : `${net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    return {
      en: `💵 Your payslip for ${monthEn(month)} is ready.\nNet pay: ${amount}`,
      km: `💵 ប័ណ្ណបើកប្រាក់ខែ ${monthKm(month)} របស់អ្នករួចរាល់ហើយ។\nប្រាក់ខែសុទ្ធ៖ ${amount}`,
    };
  },
  payslipButton(month: string): TgButton {
    return { text: { en: '💵 View payslip', km: '💵 មើលប័ណ្ណបើកប្រាក់ខែ' }, path: `/app/payslips/${month}` };
  },

  reminder(checkInTime: string): Bilingual {
    return {
      en: `⏰ You checked in at ${time12(checkInTime)} but haven't checked out yet.\nDon't forget to check out when you leave.`,
      km: `⏰ អ្នកបានចុះវត្តមានចូលម៉ោង ${time12(checkInTime)} ប៉ុន្តែមិនទាន់ចុះវត្តមានចេញទេ។\nកុំភ្លេចចុះវត្តមានចេញ ពេលចាកចេញពីការងារ។`,
    };
  },

  welcome: {
    en: '👋 Welcome to MySoft Attendance!\nTap the button below to open the app, sign in once with your company code, and check in with your phone.',
    km: '👋 សូមស្វាគមន៍មកកាន់ MySoft Attendance!\nចុចប៊ូតុងខាងក្រោម ដើម្បីបើកកម្មវិធី ចូលគណនីតែម្តងដោយប្រើលេខកូដក្រុមហ៊ុន ហើយចុះវត្តមានដោយទូរស័ព្ទរបស់អ្នក។',
  } as Bilingual,

  linked(name: string, company: string | null): Bilingual {
    const c = company ? ` (${company})` : '';
    return {
      en: `✅ Telegram is now connected to ${name}${c}.\nYou'll get messages here about your attendance, approvals and payslips.`,
      km: `✅ Telegram បានភ្ជាប់ជាមួយ ${name}${c} ហើយ។\nអ្នកនឹងទទួលបានសារនៅទីនេះ អំពីវត្តមាន ការអនុម័ត និងប្រាក់ខែរបស់អ្នក។`,
    };
  },

  linkExpired: {
    en: '⚠️ This link has expired. Open the attendance app, go to Profile → Connect Telegram and try again.',
    km: '⚠️ តំណនេះផុតកំណត់ហើយ។ សូមបើកកម្មវិធីវត្តមាន ចូលទៅ Profile → Connect Telegram ហើយសាកម្តងទៀត។',
  } as Bilingual,
};

// ---------- admin bot ----------

const LEAVE_EN = (t: string) => (LEAVE[t] ?? LEAVE.other).en;
const LEAVE_KM = (t: string) => (LEAVE[t] ?? LEAVE.other).km;
const who = (name: string, code: string) => `${name} (${code})`;

export const MANAGE_APP: TgButton = { text: { en: '🗂 Open admin app', km: '🗂 បើកកម្មវិធីគ្រប់គ្រង' }, path: '/manage' };
export const REVIEW: TgButton = { text: { en: '✅ Review now', km: '✅ ពិនិត្យឥឡូវ' }, path: '/manage/approvals' };
export const LIVE: TgButton = { text: { en: '👥 Live attendance', km: '👥 វត្តមានផ្ទាល់' }, path: '/manage/live' };

/** Names, at most `max`, then "and N more". */
function list(names: string[], max = 15, more: Bilingual = { en: 'and {n} more', km: 'និង {n} នាក់ទៀត' }): Bilingual {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  const tail = (t: string) => (rest > 0 ? `\n• ${t.replace('{n}', String(rest))}` : '');
  const body = shown.map((n) => `• ${n}`).join('\n');
  return { en: body + tail(more.en), km: body + tail(more.km) };
}

export const adminMessages = {
  newDevice(name: string, code: string, device: string | null): Bilingual {
    const d = device ? ` – ${device}` : '';
    return { en: `📱 New phone waiting for approval\n${who(name, code)}${d}`, km: `📱 ទូរស័ព្ទថ្មីកំពុងរង់ចាំការអនុម័ត\n${who(name, code)}${d}` };
  },
  newLeave(name: string, code: string, type: string, start: string, end: string, days: number, reason: string | null): Bilingual {
    const enDates = start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`;
    const kmDates = start === end ? kmDate(start) : `${kmDate(start)} ដល់ ${kmDate(end)}`;
    const r = reason?.trim() ? `\n“${reason.trim()}”` : '';
    return {
      en: `🌴 Leave request: ${who(name, code)}\n${LEAVE_EN(type)}, ${enDates} (${days} day${days === 1 ? '' : 's'})${r}`,
      km: `🌴 សំណើច្បាប់៖ ${who(name, code)}\n${LEAVE_KM(type)} ${kmDates} (${days} ថ្ងៃ)${r}`,
    };
  },
  newCorrection(name: string, code: string, date: string, type: string, time: string | null, reason: string): Bilingual {
    const t = TYPE_NOUN[type] ?? TYPE_NOUN.check_in;
    const at = time ? ` ${time12(time)}` : '';
    return {
      en: `🛠 Correction request: ${who(name, code)}\n${t.en}${at} on ${dayLabel(date)}\n“${reason}”`,
      km: `🛠 សំណើកែតម្រូវ៖ ${who(name, code)}\n${t.km}${at} ថ្ងៃ ${kmDate(date)}\n“${reason}”`,
    };
  },
  newOvertime(name: string, code: string, date: string, minutes: number): Bilingual {
    return {
      en: `⏱ Overtime to approve: ${who(name, code)}\n${minutes} min on ${dayLabel(date)}`,
      km: `⏱ ម៉ោងបន្ថែមត្រូវអនុម័ត៖ ${who(name, code)}\n${minutes} នាទី ថ្ងៃ ${kmDate(date)}`,
    };
  },
  late(name: string, code: string, time: string, minutes: number, branch: string): Bilingual {
    return {
      en: `⏰ Late: ${who(name, code)}\nChecked in ${time12(time)} (${minutes} min late) at ${branch}`,
      km: `⏰ មកយឺត៖ ${who(name, code)}\nចុះវត្តមានចូលម៉ោង ${time12(time)} (យឺត ${minutes} នាទី) នៅ ${branch}`,
    };
  },
  rejectedScan(name: string, code: string, reason: string, detail: string | null): Bilingual {
    const d = detail ? `\n${detail}` : '';
    return { en: `🚫 Scan refused: ${who(name, code)}\n${reason}${d}`, km: `🚫 ការស្កេនត្រូវបានបដិសេធ៖ ${who(name, code)}\n${reason}${d}` };
  },
  absent(date: string, names: string[]): Bilingual {
    const l = list(names);
    return {
      en: `❗ Not checked in yet on ${dayLabel(date)} (${names.length}):\n${l.en}`,
      km: `❗ មិនទាន់ចុះវត្តមាននៅថ្ងៃ ${kmDate(date)} (${names.length} នាក់)៖\n${l.km}`,
    };
  },
  summary(date: string, c: { scheduled: number; present: number; late: number; absent: number; leave: number; notYet: number }, late: string[], absent: string[]): Bilingual {
    const lateL = late.length ? list(late, 10) : null;
    const absL = absent.length ? list(absent, 10) : null;
    return {
      en: `📊 Attendance ${dayLabel(date)}\n✅ Present ${c.present}/${c.scheduled}  ⏰ Late ${c.late}  ❗ Absent ${c.absent}  🌴 Leave ${c.leave}${c.notYet ? `  ⌛ Not yet ${c.notYet}` : ''}`
        + (lateL ? `\n\nLate:\n${lateL.en}` : '') + (absL ? `\n\nAbsent:\n${absL.en}` : ''),
      km: `📊 វត្តមាន ${kmDate(date)}\n✅ មកធ្វើការ ${c.present}/${c.scheduled}  ⏰ យឺត ${c.late}  ❗ អវត្តមាន ${c.absent}  🌴 ច្បាប់ ${c.leave}${c.notYet ? `  ⌛ មិនទាន់មក ${c.notYet}` : ''}`
        + (lateL ? `\n\nមកយឺត៖\n${lateL.km}` : '') + (absL ? `\n\nអវត្តមាន៖\n${absL.km}` : ''),
    };
  },
  welcome: {
    en: '👋 MySoft Attendance for admins, HR and managers.\nTap the button below, sign in once with your email or phone, and you will get approvals, a morning summary and alerts here.',
    km: '👋 MySoft Attendance សម្រាប់អ្នកគ្រប់គ្រង HR និងប្រធានផ្នែក។\nចុចប៊ូតុងខាងក្រោម ចូលគណនីតែម្តងដោយអ៊ីមែល ឬលេខទូរស័ព្ទ ហើយអ្នកនឹងទទួលបានការអនុម័ត សេចក្តីសង្ខេបពេលព្រឹក និងការជូនដំណឹងនៅទីនេះ។',
  } as Bilingual,
};
