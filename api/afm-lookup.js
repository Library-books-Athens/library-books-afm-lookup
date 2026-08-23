export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const afm = (req.query.afm || '').trim();
  const debug = req.query.debug === '1';

  if (!/^\d{9}$/.test(afm)) {
    return res.status(400).json({ error: 'Το ΑΦΜ πρέπει να είναι 9 ψηφία.' });
  }

  const username = process.env.AADE_USERNAME;
  const password = process.env.AADE_PASSWORD;
  const myOwnAfm = process.env.AADE_OWN_AFM;

  if (!username || !password || !myOwnAfm) {
    return res.status(500).json({ error: 'Λείπουν στοιχεία διαμόρφωσης στον server.' });
  }

  const soapBody = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rg="http://rgwspublic2/RgWsPublic2Service">
  <soapenv:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <rg:rgWsPublic2AfmMethod>
      <RgWsPublic2InputRt_in>
        <INPUT_REC>
          <afmCalledBy>${myOwnAfm}</afmCalledBy>
          <afmCalledFor>${afm}</afmCalledFor>
        </INPUT_REC>
      </RgWsPublic2InputRt_in>
    </rg:rgWsPublic2AfmMethod>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const response = await fetch('https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: soapBody,
    });

    const xmlText = await response.text();

    // Modes: ?debug=1 shows the full raw XML the AADE service returned,
    // so we can see the exact tag names if parsing ever needs adjusting.
    if (debug) {
      return res.status(200).json({
        httpStatus: response.status,
        rawResponse: xmlText,
      });
    }

    // Helper: find a tag's value regardless of XML namespace prefix
    // (AADE sometimes returns tags as <tag> and sometimes as <ns2:tag>)
    const extract = (tag) => {
      const match = xmlText.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`, 'i'));
      return match ? match[1].trim() : '';
    };

    const hasFault =
      xmlText.includes('soap:Fault') ||
      xmlText.includes('<faultstring>') ||
      xmlText.includes('errorRec') ||
      xmlText.includes('<errorCode>');

    const name = extract('onomasia');

    if (hasFault || !name) {
      return res.status(404).json({
        error: 'Δεν βρέθηκε επιχείρηση με αυτό το ΑΦΜ.',
        hint: 'Αν αυτό συνεχίζεται με σωστό ΑΦΜ, δοκίμασε ?debug=1 στο URL για να δεις την ακριβή απάντηση του ΑΑΔΕ.',
      });
    }

    const postalAddress = extract('postalAddress');
    const postalAddressNo = extract('postalAddressNo');
    const postalZipCode = extract('postalZipCode');
    const postalAreaDescription = extract('postalAreaDescription');
    const doyDescr = extract('doyDescr');
    const activityDescr = extract('firmActDescription') || extract('mainActivityDescription');

    return res.status(200).json({
      afm,
      name,
      address: `${postalAddress} ${postalAddressNo}, ${postalAreaDescription} ${postalZipCode}`.trim(),
      doy: doyDescr,
      activity: activityDescr,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Σφάλμα επικοινωνίας με το ΑΑΔΕ. Δοκιμάστε ξανά.',
      details: debug ? String(error) : undefined,
    });
  }
}
