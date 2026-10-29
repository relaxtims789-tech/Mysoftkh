import { lang, t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { PageHead } from './shared';

// PDF user guides (Khmer) in public/guides/. Source and rebuild steps: marketing/guide-source/README.txt.
const MANUAL = '/guides/00-MySoft-Attendance-User-Guide-Khmer.pdf';
const GUIDES: { n: number; file: string; km: string; en: string; group: string }[] = [
  { n: 1, file: '01-Register-your-company', km: 'ចុះឈ្មោះក្រុមហ៊ុន និងចាប់ផ្ដើមប្រើ', en: 'Register your company and get started', group: 'Getting started' },
  { n: 2, file: '02-Branches-and-QR-codes', km: 'សាខា និង QR កូដ', en: 'Branches and QR codes', group: 'Getting started' },
  { n: 3, file: '03-Employees', km: 'បុគ្គលិក', en: 'Employees', group: 'Getting started' },
  { n: 4, file: '04-Phones', km: 'ទូរស័ព្ទបុគ្គលិក', en: 'Staff phones', group: 'Getting started' },
  { n: 5, file: '05-Schedules-and-holidays', km: 'កាលវិភាគការងារ និងថ្ងៃឈប់សម្រាកបុណ្យ', en: 'Work schedules and public holidays', group: 'Getting started' },
  { n: 6, file: '06-Dashboard-and-live-attendance', km: 'ផ្ទាំងគ្រប់គ្រង និងវត្តមានផ្ទាល់', en: 'Dashboard and live attendance', group: 'Daily work' },
  { n: 7, file: '07-Leave-and-scan-corrections', km: 'ច្បាប់ឈប់សម្រាក និងការកែតម្រូវ', en: 'Leave and scan corrections', group: 'Daily work' },
  { n: 8, file: '08-Overtime', km: 'ម៉ោងបន្ថែម (OT)', en: 'Overtime', group: 'Daily work' },
  { n: 9, file: '09-Payroll-and-payslips', km: 'ប្រាក់បៀវត្ស និងប័ណ្ណប្រាក់ខែ', en: 'Payroll and payslips', group: 'Payroll and reports' },
  { n: 10, file: '10-Reports', km: 'របាយការណ៍', en: 'Reports', group: 'Payroll and reports' },
  { n: 11, file: '11-Settings', km: 'ការកំណត់ក្រុមហ៊ុន វិធានវត្តមាន និងក្រុម Telegram', en: 'Settings, attendance rules and Telegram groups', group: 'Administration' },
  { n: 12, file: '12-Billing-and-payment', km: 'វិក្កយបត្រ គម្រោង និងការបង់ប្រាក់', en: 'Billing, plan and payment', group: 'Administration' },
  { n: 15, file: '15-Users-and-permissions', km: 'គណនីបុគ្គលិក និងសិទ្ធិ', en: 'Staff accounts and permissions', group: 'Administration' },
  { n: 13, file: '13-Staff-phone-app', km: 'កម្មវិធីទូរស័ព្ទសម្រាប់បុគ្គលិក', en: 'Staff phone app', group: 'Phone apps' },
  { n: 14, file: '14-Manager-phone-app', km: 'កម្មវិធីទូរស័ព្ទសម្រាប់អ្នកគ្រប់គ្រង', en: 'Manager phone app (/manage)', group: 'Phone apps' },
];
const GROUPS = ['Getting started', 'Daily work', 'Payroll and reports', 'Administration', 'Phone apps'];

export function Guides() {
  return (
    <>
      <PageHead title={t('Guidelines')} sub={t('Step-by-step guides with pictures for every part of the system (PDF, in Khmer).')}>
        <a className="btn primary" href={MANUAL} target="_blank" rel="noreferrer"><Icon name="book" size={16} /> {t('Full manual')}</a>
      </PageHead>
      <div className="card guide-manual">
        <span className="guide-ico"><Icon name="book" size={26} /></span>
        <div className="grow">
          <b>{t('MySoft Attendance user guide')}</b>
          <p className="muted small">{t('All 15 guides in one book, 44 pages. Read it on screen or print it for your HR team.')}</p>
        </div>
        <a className="btn" href={MANUAL} target="_blank" rel="noreferrer"><Icon name="eye" size={16} /> {t('Open')}</a>
        <a className="btn" href={MANUAL} download><Icon name="download" size={16} /> {t('Download')}</a>
      </div>
      {GROUPS.map((g) => (
        <section key={g} className="stack" style={{ gap: 8 }}>
          <h3 className="guide-group">{t(g)}</h3>
          <div className="guide-grid">
            {GUIDES.filter((x) => x.group === g).map((x) => {
              const href = `/guides/${x.file}.pdf`;
              return (
                <a key={x.n} className="card guide-card" href={href} target="_blank" rel="noreferrer">
                  <span className="guide-num">{x.n}</span>
                  <span className="grow">
                    <b>{lang === 'km' ? x.km : x.en}</b>
                    {lang !== 'km' && <span className="faint small">{x.km}</span>}
                  </span>
                  <Icon name="file" size={18} />
                </a>
              );
            })}
          </div>
        </section>
      ))}
      <p className="faint small">{t('Need help? Telegram @mysoftkh · 014 789 987 · 096 89 99 169')}</p>
    </>
  );
}
