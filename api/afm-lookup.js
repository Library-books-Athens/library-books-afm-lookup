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
<soapenv:Envelope xmlns:soapenv="http://www.w3.org/2003/05/soap-envelope" xmlns:rg="http://rgwspublic2/RgWsPublic2Service">
  <soapenv:Header>
    <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${username}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${password}</wsse:Password>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>
  <soapenv:Body>
    <rg:rgWsPublic2AfmMethod xmlns="http://rgwspublic2/RgWsPublic2">
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
        'Content-Type': 'application/soap+xml; charset=utf-8',
      },
      body: soapBody,
    });

    const xmlText = await response.text();

    if (debug) {
      return res.status(200).json({
        httpStatus: response.status,
        rawResponse: xmlText,
      });
    }

    const extract = (tag) => {
      const match = xmlText.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`, 'i'));
      return match ? match[1].trim() : '';
    };

    const errorDescr = extract('error_descr');
    const name = extract('onomasia');

    if (errorDescr || !name) {
      return res.status(404).json({
        error: errorDescr || 'Δεν βρέθηκε επιχείρηση με αυτό το ΑΦΜ.',
      });
    }

    const doyDescr = extract('doy_descr');
    const postalAddress = extract('postal_address');
    const postalAddressNo = extract('postal_address_no');
    const postalZipCode = extract('postal_zip_code');
    const postalAreaDescription = extract('postal_area_description');
    const legalStatusDescr = extract('legal_status_descr');

    return res.status(200).json({
      afm,
      name,
      address: `${postalAddress} ${postalAddressNo}, ${postalAreaDescription} ${postalZipCode}`.trim(),
      doy: doyDescr,
      legalStatus: legalStatusDescr,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Σφάλμα επικοινωνίας με το ΑΑΔΕ. Δοκιμάστε ξανά.',
      details: debug ? String(error) : undefined,
    });
  }
}
