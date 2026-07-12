import { createSign } from 'node:crypto';

const KLASSEN_SUFFIX = 'nails_by_julss_treuekarte';

function issuerId() {
  return process.env.GOOGLE_WALLET_ISSUER_ID || '';
}

let saCache = null;
function serviceAccount() {
  if (saCache) return saCache;
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '';
  if (!raw) return null;
  try {
    if (!raw.trim().startsWith('{')) {
      raw = Buffer.from(raw, 'base64').toString('utf8');
    }
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) return null;
    saCache = sa;
    return sa;
  } catch {
    return null;
  }
}

export function konfiguriert() {
  return Boolean(issuerId() && serviceAccount());
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(claims) {
  const sa = serviceAccount();
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${body}`);
  const sig = signer.sign(sa.private_key).toString('base64url');
  return `${header}.${body}.${sig}`;
}

function klassenId() {
  return `${issuerId()}.${KLASSEN_SUFFIX}`;
}

function objektId(karteId) {
  return `${issuerId()}.k${karteId.replace(/-/g, '')}`;
}

function loyaltyClass(baseUrl) {
  return {
    id: klassenId(),
    issuerName: 'Nails by Julss',
    programName: 'Treuekarte',
    programLogo: { sourceUri: { uri: `${baseUrl}/icons/icon-512.png` } },
    reviewStatus: 'UNDER_REVIEW',
    hexBackgroundColor: '#c7431f'
  };
}

function loyaltyObject(karte, baseUrl) {
  return {
    id: objektId(karte.id),
    classId: klassenId(),
    state: 'ACTIVE',
    accountId: karte.id,
    accountName: karte.name,
    loyaltyPoints: {
      label: 'Stempel',
      balance: { int: karte.position }
    },
    barcode: {
      type: 'QR_CODE',
      value: `${baseUrl}/k/${karte.id}`,
      alternateText: karte.name
    },
    textModulesData: [
      {
        header: 'So funktioniert’s',
        body: 'Sammle bei jedem Besuch einen Stempel. Beim 5. Besuch gibt es 5 € Rabatt, beim 10. Besuch 50 % auf eine Behandlung.'
      }
    ]
  };
}

export function saveUrl(karte, baseUrl) {
  const sa = serviceAccount();
  const jwt = signJwt({
    iss: sa.client_email,
    aud: 'google',
    typ: 'savetowallet',
    iat: Math.floor(Date.now() / 1000),
    origins: [baseUrl],
    payload: {
      loyaltyClasses: [loyaltyClass(baseUrl)],
      loyaltyObjects: [loyaltyObject(karte, baseUrl)]
    }
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

async function accessToken() {
  const sa = serviceAccount();
  const iat = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: 'https://oauth2.googleapis.com/token',
    iat,
    exp: iat + 3600
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  if (!res.ok) throw new Error(`OAuth-Token fehlgeschlagen: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export async function punkteAktualisieren(karte) {
  if (!konfiguriert()) return;
  const token = await accessToken();
  const res = await fetch(
    `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objektId(karte.id)}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        loyaltyPoints: { label: 'Stempel', balance: { int: karte.position } }
      })
    }
  );
  if (res.status === 404) return;
  if (!res.ok) throw new Error(`Wallet-Update fehlgeschlagen: ${res.status}`);
}
