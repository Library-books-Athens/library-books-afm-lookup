import * as soapPkg from 'soap';
const soap = soapPkg.default || soapPkg;

const WSDL_URL = 'https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2?WSDL';

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

  try {
    const client = await soap.createClientAsync(WSDL_URL, { forceSoap12Headers: true });
    client.setSecurity(new soap.WSSecurity(username, password, { passwordType: 'PasswordText' }));

    const [result, rawResponse] = await client.rgWsPublic2AfmMethodAsync({
      INPUT_REC: {
        afm_called_by: myOwnAfm,
        afm_called_for: afm,
      },
    });

    if (debug) {
      return res.status(200).json({ result, rawResponse });
    }

    const inner = result?.result?.rg_ws_public2_result_rtType;
    const basicRec = inner?.basic_rec;
    const errorRec = inner?.error_rec;

    if (errorRec?.error_descr || !basicRec?.onomasia) {
      return res.status(404).json({
        error: errorRec?.error_descr || 'Δεν βρέθηκε επιχείρηση με αυτό το ΑΦΜ.',
      });
    }

    return res.status(200).json({
      afm,
      name: basicRec.onomasia,
      address: `${basicRec.postal_address || ''} ${basicRec.postal_address_no || ''}, ${basicRec.postal_area_description || ''} ${basicRec.postal_zip_code || ''}`.trim(),
      doy: basicRec.doy_descr,
      legalStatus: basicRec.legal_status_descr,
    });
  } catch (error) {
    return res.status(502).json({
      error: 'Σφάλμα επικοινωνίας με το ΑΑΔΕ. Δοκιμάστε ξανά.',
      details: debug ? String(error) : undefined,
    });
  }
}
