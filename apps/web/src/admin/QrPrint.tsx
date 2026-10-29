import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import '../admin/admin.css';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { ErrorText, Loading, useLoad } from '../components/ui';

interface PrintData { id: string; branchName: string; label: string | null; url: string; companyName: string; companyLogo: string | null; svg: string }

/** Clean printable poster: A4 for walls, 10×15 cm for desk stands. */
export function QrPrint() {
  const { id } = useParams();
  const [size, setSize] = useState<'a4' | 'stand'>('a4');
  const { data, error, loading } = useLoad(() => api<PrintData>(`/qr/${id}/print`), [id]);
  if (loading) return <Loading />;
  if (!data) return <div style={{ padding: 20 }}><ErrorText error={error} /></div>;

  return (
    <div>
      <style>{`@media print { @page { size: ${size === 'a4' ? 'A4 portrait' : '100mm 150mm'}; margin: 0; } }`}</style>
      <div className="print-toolbar no-print">
        <Link to="/admin/qr" className="btn sm"><Icon name="left" size={14} /> {t('QR codes')}</Link>
        <div className="chips" style={{ marginLeft: 8 }}>
          <button className={`chip${size === 'a4' ? ' on' : ''}`} onClick={() => setSize('a4')}>{t('A4 poster')}</button>
          <button className={`chip${size === 'stand' ? ' on' : ''}`} onClick={() => setSize('stand')}>{t('Stand 10×15 cm')}</button>
        </div>
        <div className="grow" />
        <button className="btn primary" onClick={() => window.print()}><Icon name="printer" size={16} /> {t('Print')}</button>
      </div>
      <div className="print-stage">
        <div className={`poster ${size}`}>
          <div className="p-logo">
            {data.companyLogo ? <img src={data.companyLogo} alt="" /> : null}
            {!data.companyLogo && <div className="p-company">{data.companyName}</div>}
          </div>
          <div className="p-title">{t('SCAN TO ATTEND')}</div>
          <div className="p-qr" dangerouslySetInnerHTML={{ __html: data.svg }} />
          <div className="p-branch">{data.branchName}</div>
          <div className="p-help">{t('Please scan using')}<br />{t('your phone')}</div>
          <div className="p-foot">{data.companyLogo ? `${data.companyName} · ` : ''}{data.label ?? ''} · {t('Open the attendance app and tap SCAN QR')}</div>
        </div>
      </div>
    </div>
  );
}
