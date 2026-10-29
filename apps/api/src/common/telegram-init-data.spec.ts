import { signInitData, verifyInitData } from './telegram-init-data';

const TOKEN = '123456:ABC-test-token';
const make = (over: Record<string, string> = {}, token = TOKEN) => {
  const fields: Record<string, string> = {
    query_id: 'AAH',
    user: JSON.stringify({ id: 512345678, first_name: 'Dara', username: 'dara', language_code: 'km' }),
    auth_date: String(Math.floor(Date.now() / 1000) - 60),
    ...over,
  };
  return new URLSearchParams({ ...fields, hash: signInitData(fields, token) }).toString();
};

describe('verifyInitData (Telegram Mini App)', () => {
  it('accepts data signed with the bot token', () => {
    const r = verifyInitData(make(), TOKEN);
    expect(r?.user).toMatchObject({ id: 512345678, language_code: 'km' });
  });
  it('rejects another bot, changed fields, old data and garbage', () => {
    expect(verifyInitData(make(), '999:other')).toBeNull();
    expect(verifyInitData(make().replace('512345678', '512345679'), TOKEN)).toBeNull();
    expect(verifyInitData(make({ auth_date: String(Math.floor(Date.now() / 1000) - 2 * 86400) }), TOKEN)).toBeNull();
    expect(verifyInitData('hash=abc&user=%7B%7D', TOKEN)).toBeNull();
    expect(verifyInitData('', TOKEN)).toBeNull();
  });
});
