import https from 'https';
import http from 'http';

function reqHttp(url, opts = {}) {
  return new Promise((res, rej) => {
    const r = http.request(url, { ...opts }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

function req(url, opts = {}) {
  return new Promise((res, rej) => {
    const r = https.request(url, { ...opts }, resp => {
      let d = ''; resp.on('data', c => d += c); resp.on('end', () => res({ status: resp.statusCode, body: d }));
    });
    r.on('error', rej);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

async function main() {
  // Login as teacher
  let r = await req('https://dev-jegs.buru-degree.ts.net/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'miguel.valdez@deped.edu.ph', password: 'DepEd2026!' })
  });
  const teacherData = JSON.parse(r.body);
  const teacherToken = teacherData.token;
  console.log('=== TEACHER LOGIN ===');
  console.log(JSON.stringify(teacherData.user, null, 2));

  // Login as registrar
  r = await req('https://dev-jegs.buru-degree.ts.net/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'regina.cruz@deped.edu.ph', password: 'Gx$P*w2$TuKW' })
  });
  const regData = JSON.parse(r.body);
  const regToken = regData.token;
  console.log('\n=== REGISTRAR LOGIN ===');
  console.log(JSON.stringify(regData.user, null, 2));

  // Teacher /me profile
  r = await req('https://dev-jegs.buru-degree.ts.net/api/me', {
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  console.log('\n=== TEACHER /me ===');
  console.log(r.body.substring(0, 1000));

  // Try /api/teacher/profile
  r = await req('https://dev-jegs.buru-degree.ts.net/api/teacher/profile', {
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  console.log('\n=== TEACHER /teacher/profile ===');
  console.log(r.body.substring(0, 1000));

  // Try /api/teachers/me
  r = await req('https://dev-jegs.buru-degree.ts.net/api/teachers/me', {
    headers: { 'Authorization': 'Bearer ' + teacherToken }
  });
  console.log('\n=== TEACHER /teachers/me ===');
  console.log(r.body.substring(0, 1000));

  // Try integration faculty filtered by teacher ID (from token: userId=2369)
  r = await req('https://dev-jegs.buru-degree.ts.net/api/integration/v1/faculty?schoolYearId=8&limit=200', {});
  const allFac = JSON.parse(r.body);
  const miguelf = allFac.data.find(f => f.firstName === 'MIGUEL' && f.lastName === 'VALDEZ');
  console.log('\n=== MIGUEL VALDEZ in faculty ===');
  console.log(JSON.stringify(miguelf, null, 2));

  // Try subjects from ATLAS (http)
  const atlasSubj = await reqHttp('http://100.88.55.125:5001/api/v1/subjects?schoolId=5', {});
  console.log('\n=== ATLAS SUBJECTS ===');
  console.log(atlasSubj.body.substring(0, 1000));

  // Fetch all faculty page 1
  r = await req('https://dev-jegs.buru-degree.ts.net/api/integration/v1/faculty?schoolYearId=8&limit=5&page=1', {});
  const facData = JSON.parse(r.body);
  console.log('\n=== FACULTY SAMPLE (5 records) ===');
  console.log(JSON.stringify(facData.data.slice(0, 3), null, 2));
  console.log('Total faculty:', facData.meta.total);
}

main().catch(e => console.error(e));
