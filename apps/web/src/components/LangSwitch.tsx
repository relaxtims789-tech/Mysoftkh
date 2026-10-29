import { lang, setLang } from '../lib/i18n';

/** ខ្មែរ / English switch. Shows the other language; choosing it reloads the page in that language. */
export function LangSwitch({ className = 'btn sm ghost', style }: { className?: string; style?: React.CSSProperties }) {
  const other = lang === 'km' ? 'en' : 'km';
  return (
    <button type="button" className={className} style={style} onClick={() => setLang(other)} lang={other}
      aria-label={other === 'km' ? 'ប្តូរទៅភាសាខ្មែរ' : 'Switch to English'} title={other === 'km' ? 'ភាសាខ្មែរ' : 'English'}>
      {other === 'km' ? 'ខ្មែរ' : 'English'}
    </button>
  );
}
