/**
 * SMART — Student & Class Assignment Import Script
 *
 * Generates:
 *  1. Students with real-format LRNs + Filipino names, linked to sections via Enrollment
 *  2. ClassAssignments (teacher → subject → section) with a DepEd-style distribution
 *
 * LRN format (DepEd Philippines, 12 digits):
 *   [Region 3-digit][Division 3-digit][School 3-digit][Sequence 3-digit]
 *   We use:  150  (Region X placeholder)
 *            123  (Division code)
 *            456  (School code)
 *            000001 … → combined as 12-digit: 150123456NNNNN  (5-digit seq)
 *
 * Usage:
 *   cd server && npx tsx import-students.ts
 *
 * ATLAS override (run again when credentials are available):
 *   Set ATLAS_TOKEN=<enrollpro-jwt> in .env, then re-run.
 *   The script will pull real faculty assignments from ATLAS and override heuristics.
 */

import 'dotenv/config';
import https from 'https';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ─── Prisma ──────────────────────────────────────────────────────────────────
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any);

// ─── Constants ───────────────────────────────────────────────────────────────
const SCHOOL_YEAR = '2026-2027';
const STUDENTS_PER_SECTION = 45;
const ATLAS_BASE = 'http://100.88.55.125:5001/api/v1';
const ATLAS_SCHOOL_ID = 5;
const ATLAS_SY_ID = 8;

// DepEd LRN prefix: Region-Division-School (9 digits), + 5-digit sequence = 14? No, LRN is 12 digits.
// Standard DepEd LRN: 12 digits. School-based numbering.
// Format: SSSSSSYYNNNNN where SSSSSS=school code, YY=year, NNNNN=sequence
const LRN_SCHOOL_CODE = '150123'; // 6-digit school code (placeholder)

// ─── Filipino name pools ──────────────────────────────────────────────────────
const MALE_FIRST: string[] = [
  'Aaron','Adrian','Aldric','Alexis','Alfonso','Alfred','Alvin','Andrei','Angelo','Anthony',
  'Antonio','Arjay','Arnel','Arnold','Arthur','Benito','Benjamin','Carlo','Carlos','Christian',
  'Christopher','Clarence','Clark','Clyde','Daniel','Darwin','David','Dino','Dominic','Edmar',
  'Eduardo','Emmanuel','Enrique','Eric','Erwin','Eugene','Ezekiel','Ferdinand','Francis','Francisco',
  'Gabriel','Gerald','Gian','Gilbert','Glen','Harold','Hector','Ian','Isidro','Ivan',
  'Jared','Jason','Jasper','Javier','Jefferson','Jeffrey','Jerome','Jesse','Joel','John',
  'Jonathan','Jordan','Jorge','Joseph','Joshua','Juan','Julius','Justin','Karl','Kenneth',
  'Kevin','Kristopher','Lance','Lawrence','Leo','Leonard','Lorenzo','Luis','Luisito','Manolo',
  'Marc','Marco','Mark','Martin','Matthew','Michael','Miguel','Nathan','Neil','Nelson',
  'Nestor','Nicholas','Noel','Norman','Oliver','Oscar','Patrick','Paul','Pedro','Philip',
  'Ramon','Raphael','Raymond','Ricardo','Rico','Rogelio','Ronald','Ryan','Samuel','Sebastian',
  'Sergio','Sheldon','Stephen','Timothy','Tobias','Victor','Vincent','Warren','Xavier','Zachary',
];

const FEMALE_FIRST: string[] = [
  'Abigail','Agnes','Alexandra','Alice','Alicia','Amanda','Amelia','Andrea','Angela','Angelica',
  'Anna','Antonette','April','Arielle','Ashley','Beatrice','Bianca','Camille','Carla','Carmela',
  'Carmen','Cassandra','Catherine','Cecilia','Charlene','Christine','Clara','Clarissa','Cleo','Corazon',
  'Cristina','Danica','Danielle','Dawn','Denise','Diana','Dolores','Donna','Dorothy','Eden',
  'Elena','Elisa','Elizabeth','Ella','Ellen','Emily','Erica','Esperanza','Estela','Eva',
  'Faith','Fatima','Felicia','Fernanda','Frances','Gemma','Gina','Gloria','Grace','Hannah',
  'Hazel','Isabel','Isabella','Jacqueline','Jane','Jasmine','Jennifer','Jessica','Joanna','Josephine',
  'Joyce','Juanita','Karen','Katherine','Katrina','Kristine','Laura','Lea','Leah','Lena',
  'Leonor','Liza','Lorena','Lourdes','Lucila','Luisa','Luna','Lydia','Mae','Maica',
  'Maria','Maricel','Marilou','Marilyn','Marina','Mary','Maxine','Maya','Michelle','Mira',
  'Monica','Nadine','Nicole','Nora','Norma','Olivia','Patricia','Paula','Pauline','Precious',
  'Princess','Rachel','Rebecca','Regina','Rica','Rita','Rosalie','Rosalind','Rose','Rowena',
  'Ruby','Sandra','Sarah','Sheila','Shirley','Sofia','Sophia','Stella','Theresa','Vanessa',
  'Veronica','Victoria','Vivian','Wendy','Xandria','Ynez','Yolanda','Zara','Zelda','Zoe',
];

const LAST_NAMES: string[] = [
  'Abad','Abano','Abara','Abcede','Abello','Abenes','Abenis','Ablaza','Ablir','Ablog',
  'Acevedo','Aclan','Acosta','Adriano','Agapito','Agaton','Aguilar','Aguinaldo','Agustin','Alano',
  'Alba','Albano','Albay','Alcala','Aldaba','Alegre','Alejandro','Alipio','Almazan','Almeda',
  'Almonte','Alonzo','Altamira','Alvarado','Alves','Amador','Amante','Ambrocio','Amistoso','Amor',
  'Amparo','Anacleto','Andal','Andrade','Angeles','Angulo','Antonio','Apolinario','Apolonio','Aquino',
  'Aranda','Arce','Arceo','Arceta','Arellano','Ares','Arguelles','Arias','Arienza','Arnaiz',
  'Aromin','Arroyo','Arteche','Asis','Atienza','Avila','Ayala','Ayson','Azores','Azurin',
  'Baba','Bacal','Bacalso','Bacani','Bacarra','Bacay','Bacayo','Baccay','Bacong','Bacolod',
  'Baculi','Badillo','Bagao','Bagas','Bagay','Bagtas','Bagtong','Balagtas','Balboa','Baldoz',
  'Balinos','Ballares','Ballesteros','Baltazar','Banaag','Banaag','Banagala','Banayad','Bantad','Banzuela',
  'Barba','Barbero','Barbon','Barcelon','Barcelo','Barela','Barrion','Bartolome','Basallo','Basco',
  'Basi','Basig','Basilio','Bautista','Baysa','Belen','Beleno','Bello','Bellosillo','Beltran',
  'Benedicto','Benitez','Bernardino','Bernardo','Bilbao','Billena','Binay','Blas','Bocalbos','Bohol',
  'Bondoc','Bonifacio','Borja','Borneos','Borra','Borras','Bravo','Bredo','Brillantes','Briones',
  'Brioso','Briz','Buenaflor','Buenafe','Buenaventura','Bueno','Buenviaje','Bugayong','Bulos','Buna',
  'Bunag','Buño','Bunyog','Burgos','Butao','Butor','Caagbay','Cababao','Cabal','Cabalo',
  'Caballero','Cabantog','Cabarles','Cabarrus','Cabello','Cabeza','Cabigon','Cabiling','Cabinta','Cabral',
  'Cabrera','Cabuay','Cabuenas','Cabuhat','Cacal','Caces','Cadag','Cadatal','Cadato','Cadenas',
  'Caguioa','Cahill','Cajipe','Cajulis','Calabio','Caladiao','Calalo','Calamba','Calape','Calapan',
  'Calatrava','Calaunan','Calayag','Calayco','Calayo','Calderon','Calleja','Calma','Calub','Calucin',
  'Camara','Camacho','Camia','Camiling','Camino','Camorongan','Campos','Camus','Canapi','Canda',
  'Cangco','Cano','Caoile','Capanas','Capistrano','Capito','Caraig','Carandang','Carang','Carbonell',
  'Cardenas','Cardona','Carillo','Cariño','Carlos','Carmona','Caro','Casanova','Casem','Casiano',
  'Casidsid','Casimiro','Castañeda','Castellano','Castillo','Castro','Catacutan','Catalan','Catanghal','Catapang',
  'Celeste','Cendaña','Ceniza','Cervantes','Chiong','Cipriano','Clarete','Clarin','Claudio','Claveria',
  'Clemencia','Cobilla','Cobrador','Colobong','Coloma','Colon','Concepcion','Condeza','Consuegra','Copino',
  'Coprada','Corcino','Cordero','Cornelio','Corpuz','Coruña','Cosico','Cosme','Costas','Cotangco',
  'Crisanto','Crisostomo','Cristobal','Cruz','Cuadra','Cuba','Cucio','Cuenco','Cuevas','Cunanan',
  'Custodio','Dacayanan','Dacanay','Dacera','Dacula','Dagdag','Dagohoy','Dalangin','Dalisay','Dalmacio',
  'Dalusong','Damasco','Dapiton','Dapitan','Dapo','Daquioag','Darnayla','Datu','Dazo','De Castro',
  'De Guzman','De Jesus','De la Cruz','De la Paz','De Leon','De Lima','De los Reyes','De los Santos',
  'De Villa','Debuque','Decano','Decena','Decla','Degamo','Del Mundo','Del Rosario','Del Valle','Delgado',
  'Delos Reyes','Delos Santos','Descartin','Destura','Devera','Deza','Diaz','Diezmo','Dilag','Dizon',
  'Dolores','Domingo','Donato','Dorado','Doria','Doromal','Dueñas','Duero','Dulay','Duldulao',
  'Dumaliang','Duma','Dumilug','Dumo','Duque','Duran','Dural','Duremdes','Duro','Ebcas',
  'Ebdane','Ebora','Echevarria','Economos','Edaño','Edañol','Eguia','Elago','Elban','Elberto',
  'Elefante','Elizaga','Empleo','Encarnacion','Encinas','Encinares','Endencia','Endozo','Enriquez','Enteria',
  'Epino','Ermita','Escalante','Escobar','Escorial','Escosura','Escoto','Escudero','Esmeralda','Espaldon',
  'Espana','Espejo','Espera','Esperas','Esperanza','Espina','Espino','Espinosa','Esquivel','Estacio',
  'Esteves','Esteves','Estocado','Estoista','Estrella','Etong','Evangelista','Evaristo','Evasco','Fabian',
  'Fabicon','Fajardo','Fajutagana','Faraon','Farinas','Feliciano','Felix','Fermin','Fernandez','Fernando',
  'Ferraren','Ferrer','Flores','Floresca','Floro','Fontanilla','Forbes','Formantes','Foronda','Forones',
  'Francisco','Frando','Frias','Frias','Frivaldo','Frondoso','Fuentes','Fule','Gabasa','Gabi',
  'Gabriel','Gabrillo','Gacayan','Galang','Galarpe','Galido','Galindo','Galo','Galvez','Gamboa',
  'Gamil','Gamilla','Gamos','Gancayco','Garcia','Garot','Garrido','Gascon','Gatchalian','Gatdula',
  'Gatus','Gaviola','Geronimo','Gerundio','Giangan','Gloria','Glorioso','Go','Gob','Goce',
  'Golez','Gomez','Gonzaga','Gonzales','Gonzalez','Gozon','Grabato','Gracia','Granado','Gregorio',
  'Guerrero','Guevarra','Guilaran','Guillermo','Guinto','Guiron','Gulmatico','Gutierrez','Guzon','Hayudini',
  'Hernandez','Herrera','Hidalgo','Hilario','Hizon','Hobila','Honasan','Honoridez','Hontiveros','Ibe',
  'Ibanez','Ibañez','Ignacio','Ilustre','Imperial','Inocencio','Isip','Israel','Jacinto','Javier',
  'Jereza','Jimenez','Joson','Judan','Juntilla','Kho','Laguardia','Laguda','Laguerder','Lagundino',
  'Lapa','Lapid','Larano','Laray','Largoza','Laserna','Lasin','Lazaro','Legarda','Legazpi',
  'Leguisamo','Lim','Linao','Lindo','Llamas','Llamzon','Llobrera','Llona','Lobo','Locsin',
  'Lopez','Lorenzana','Loyola','Lucero','Lukban','Luna','Luntok','Lupac','Lupo','Lustria',
  'Macabulos','Macapagal','Macasaet','Maceda','Macuha','Madriaga','Magsaysay','Magtubo','Mahilum','Makinano',
  'Mallo','Mamon','Manalo','Mangahas','Mangubat','Manicad','Manigque','Manlangit','Manlapaz','Mansalay',
  'Mantos','Manuel','Mapalad','Marasigan','Marcos','Maranan','Maranon','Marcelino','Marcelo','Mariano',
  'Marqueses','Marquez','Martinez','Matienzo','Matira','Matubis','Matunog','Medina','Mejia','Mendoza',
  'Mercado','Merioles','Militante','Miranda','Molina','Molon','Mondejar','Monsod','Montano','Montoya',
  'Morales','Morata','Morcoso','Moredo','Morelos','Moreno','Mosqueda','Movido','Muerong','Muñoz',
  'Nabua','Nabuab','Nacpil','Nadela','Nagrampa','Nalangan','Nardo','Narvasa','Navarro','Navia',
  'Nieva','Niones','Niño','Nobres','Nonato','Noriega','Nuguid','Obias','Ocampo','Ojeda',
  'Olarte','Olegario','Olivares','Oliveros','Ong','Ople','Ora','Orbeta','Orcullo','Ordoña',
  'Ordoñez','Oreta','Oropilla','Orosa','Ortega','Ortiz','Osias','Osmena','Ott','Pablo',
  'Pabalan','Pabalate','Pabelico','Pabualan','Pacheco','Padilla','Paga','Pagulayan','Palad','Palafox',
  'Palaganas','Palamit','Palana','Palanas','Palangdao','Palero','Palileng','Palma','Palomar','Pama',
  'Panagsagan','Panaligan','Pangan','Pangilinan','Panibio','Paningbatan','Papina','Papio','Paragas','Parallag',
  'Paranada','Pardinas','Paredes','Parojinog','Parrucho','Pasay','Pascua','Pascual','Pasion','Patdu',
  'Patiño','Patoc','Patrona','Patulot','Payawal','Payte','Pena','Peña','Penaflorida','Pendatun',
  'Perez','Picardal','Pilario','Pineda','Pingol','Pinugu','Pirante','Piñero','Ples','Potot',
  'Puno','Querubin','Quilala','Quimbo','Quinagoran','Quinain','Quinao','Quinay','Quino','Quirog',
  'Quiroz','Quisay','Quisumbing','Rabo','Racho','Raganas','Raguindin','Ramos','Rañola','Razon',
  'Real','Recabar','Regio','Reillosa','Relampagos','Remigio','Remudaro','Rendon','Rentoy','Respicio',
  'Reyes','Reynaldo','Rimando','Rimon','Rivera','Rizal','Robles','Rodriguez','Rojas','Roldan',
  'Rollan','Roman','Ronquillo','Roque','Rosales','Rosario','Roxas','Sabado','Saber','Sacbibit',
  'Saclolo','Sagun','Salazar','Saldaña','Sales','Salinas','Salita','Salon','Salvador','Samaniego',
  'Sambrano','Samson','Sanchez','Sangalang','Santos','Saquing','Sarabia','Sarino','Sarmiento','Sazon',
  'Sebastian','Serdan','Serrano','Serrano','Sicat','Sierra','Siguion','Simbulan','Simbulas','Sison',
  'Sisón','Soberano','Sobrepena','Soco','Soriano','Soria','Sotto','Suarez','Suico','Sulpicio',
  'Sy','Tabadero','Tabirara','Tabunda','Tagayuna','Taguba','Tagum','Taguibao','Tahil','Tan',
  'Tanchoco','Tangco','Tangkia','Tangon','Tano','Taño','Tañola','Taoli','Tapangan','Tara',
  'Tarrayo','Tavarrez','Tawatao','Tayag','Tayco','Taylan','Taylo','Tayong','Taypin','Tecson',
  'Tee','Tejada','Tejano','Tejares','Tente','Teodoro','Tercero','Tiburcio','Ticman','Timog',
  'Tiongco','Tiongson','Tirona','Tobias','Tolentino','Torres','Tosino','Tuazon','Tulabut','Tumbaga',
  'Ungab','Urquiola','Uson','Valdez','Valencia','Valenzuela','Valle','Vargas','Vega','Velardo',
  'Velasco','Velasquez','Ventura','Vera','Vergara','Veron','Vibar','Viernes','Villa','Villafuerte',
  'Villalba','Villaluz','Villanueva','Villanveva','Villanuevo','Villareal','Villarin','Villasanta','Villavert','Viloria',
  'Virata','Yap','Yatco','Yniguez','Yuzon','Zabala','Zalamea','Zaldivar','Zamora','Zara',
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function seededInt(seed: number, mod: number): number {
  // Deterministic "random" using seed — reproducible across runs
  return ((seed * 1664525 + 1013904223) >>> 0) % mod;
}

function genLrn(sequenceNum: number): string {
  // DepEd LRN: 12 digits — SSSSSSYYNNNNN (6-char school code + 2-digit year + padding)
  // We use: school=100456, year=26, seq=XXXXXX
  const seq = String(sequenceNum).padStart(6, '0');
  return `100456${seq}`;
}

function genBirthDate(gradeLevel: string): Date {
  // Grade 7: ~12 yrs old in 2026 → born 2013-2014
  // Grade 8: ~13 yrs old → born 2012-2013
  // Grade 9: ~14 yrs old → born 2011-2012
  // Grade 10: ~15 yrs old → born 2010-2011
  const gradeToBaseYear: Record<string, number> = {
    GRADE_7: 2013, GRADE_8: 2012, GRADE_9: 2011, GRADE_10: 2010,
  };
  const baseYear = gradeToBaseYear[gradeLevel] ?? 2012;
  const year = baseYear + (Math.random() > 0.5 ? 0 : -1);
  const month = Math.floor(Math.random() * 12) + 1;
  const day = Math.floor(Math.random() * 28) + 1;
  return new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
}

// ─── ATLAS helpers ────────────────────────────────────────────────────────────
function atlasGet(path: string, token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `${ATLAS_BASE}${path}`;
    const opts = {
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = (url.startsWith('https') ? https : require('http')).get(url, opts, (res: any) => {
      let body = '';
      res.on('data', (chunk: any) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`JSON parse error: ${body.substring(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('ATLAS timeout')); });
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       SMART — Student & Class Assignment Importer        ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 1. Fetch sections ────────────────────────────────────────────────────
  console.log('📚 Step 1: Loading sections from SMART DB...');
  const sections = await prisma.section.findMany({
    orderBy: [{ gradeLevel: 'asc' }, { name: 'asc' }],
  });
  console.log(`   Found ${sections.length} sections.\n`);

  // ── 2. Generate students ─────────────────────────────────────────────────
  console.log(`👨‍🎓 Step 2: Generating ${STUDENTS_PER_SECTION} students per section (${sections.length * STUDENTS_PER_SECTION} total)...`);
  
  let lrnCounter = 1;
  let studentCount = 0;
  let enrollmentCount = 0;

  for (const section of sections) {
    for (let i = 0; i < STUDENTS_PER_SECTION; i++) {
      const isMale = (lrnCounter + i) % 2 === 0;
      const firstName = isMale ? pick(MALE_FIRST) : pick(FEMALE_FIRST);
      const lastName = pick(LAST_NAMES);
      const middleInitials = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
      const middleName = pick(middleInitials) + '.';
      const lrn = genLrn(lrnCounter);
      const gender = isMale ? 'Male' : 'Female';
      const birthDate = genBirthDate(section.gradeLevel);

      try {
        const student = await prisma.student.upsert({
          where: { lrn },
          update: {},
          create: {
            lrn,
            firstName,
            middleName,
            lastName,
            gender,
            birthDate,
          },
        });

        await prisma.enrollment.upsert({
          where: { studentId_sectionId_schoolYear: { studentId: student.id, sectionId: section.id, schoolYear: SCHOOL_YEAR } },
          update: {},
          create: {
            studentId: student.id,
            sectionId: section.id,
            schoolYear: SCHOOL_YEAR,
            status: 'ENROLLED',
          },
        });

        studentCount++;
        enrollmentCount++;
      } catch {
        // skip duplicates
      }

      lrnCounter++;
    }

    if (sections.indexOf(section) % 10 === 0) {
      console.log(`   ... processed ${sections.indexOf(section) + 1}/${sections.length} sections`);
    }
  }
  console.log(`   ✔ Created ${studentCount} students, ${enrollmentCount} enrollments.\n`);

  // ── 3. Class Assignments ─────────────────────────────────────────────────
  console.log('📋 Step 3: Creating class assignments (teacher → subject → section)...');

  const atlasToken = process.env.ATLAS_TOKEN;
  let atlasAssignments: Map<string, string[]> | null = null; // email → subjectCodes[]

  if (atlasToken) {
    console.log('   ATLAS_TOKEN found — pulling real faculty assignments...');
    try {
      const data = await atlasGet(
        `/faculty-assignments/summary?schoolId=${ATLAS_SCHOOL_ID}&schoolYearId=${ATLAS_SY_ID}`,
        atlasToken,
      );
      // data.faculty[].name, data.faculty[].assignedSubjects (codes)
      atlasAssignments = new Map<string, string[]>();
      for (const f of (data.faculty ?? [])) {
        const email = f.email ?? f.name?.toLowerCase().replace(' ', '.') + '@deped.edu.ph';
        atlasAssignments.set(email, f.assignedSubjects ?? []);
      }
      console.log(`   ✔ Got ATLAS assignments for ${atlasAssignments.size} faculty.`);
    } catch (err: any) {
      console.warn(`   ⚠ ATLAS pull failed (${err.message}). Falling back to heuristic distribution.`);
    }
  } else {
    console.log('   No ATLAS_TOKEN — using heuristic subject distribution.');
  }

  const teachers = await prisma.teacher.findMany({
    include: { user: true },
    orderBy: { id: 'asc' },
  });
  const subjects = await prisma.subject.findMany({ orderBy: { code: 'asc' } });

  let caCreated = 0;
  let caSkipped = 0;

  if (atlasAssignments) {
    // ── ATLAS mode: use real assignments ──────────────────────────────────
    for (const teacher of teachers) {
      const codes = atlasAssignments.get(teacher.user.email ?? '') ?? [];
      const teacherSubjects = subjects.filter(s => codes.includes(s.code));
      if (teacherSubjects.length === 0) continue;

      // Find sections for this teacher's grade level (from adviser link or all)
      const assignedSections = sections.filter(sec =>
        teacherSubjects.some(() => true) // will be refined by grade level from ATLAS
      );

      for (const sub of teacherSubjects) {
        for (const sec of assignedSections.slice(0, 4)) { // cap at 4 sections per teacher
          try {
            await prisma.classAssignment.upsert({
              where: { teacherId_subjectId_sectionId_schoolYear: {
                teacherId: teacher.id, subjectId: sub.id, sectionId: sec.id, schoolYear: SCHOOL_YEAR,
              }},
              update: {},
              create: { teacherId: teacher.id, subjectId: sub.id, sectionId: sec.id, schoolYear: SCHOOL_YEAR },
            });
            caCreated++;
          } catch { caSkipped++; }
        }
      }
    }
  } else {
    // ── Heuristic mode: distribute subjects evenly across teachers ────────
    // Strategy:
    //   - 8 subjects, 142 teachers → ~17-18 teachers per subject
    //   - Each teacher handles their subject across ~4 sections
    //   - Adviser teachers get their subject in their own section first
    //   - Group sections by grade level, distribute within grade

    // Group sections by grade level
    const sectionsByGrade = new Map<string, typeof sections>();
    for (const s of sections) {
      const arr = sectionsByGrade.get(s.gradeLevel) ?? [];
      arr.push(s);
      sectionsByGrade.set(s.gradeLevel, arr);
    }

    // Distribute teachers across subjects (round-robin by teacher index)
    for (let subIdx = 0; subIdx < subjects.length; subIdx++) {
      const subject = subjects[subIdx];

      // Teachers assigned to this subject (every 8th teacher offset by subIdx)
      const subjectTeachers = teachers.filter((_, tIdx) => tIdx % subjects.length === subIdx);

      // Flatten all sections, distribute among subject's teachers
      const allSections = [...sections];
      const sectionsPerTeacher = Math.ceil(allSections.length / Math.max(subjectTeachers.length, 1));

      for (let tIdx = 0; tIdx < subjectTeachers.length; tIdx++) {
        const teacher = subjectTeachers[tIdx];
        const start = tIdx * sectionsPerTeacher;
        const end = Math.min(start + sectionsPerTeacher, allSections.length);
        const teacherSections = allSections.slice(start, end);

        for (const sec of teacherSections) {
          try {
            await prisma.classAssignment.upsert({
              where: { teacherId_subjectId_sectionId_schoolYear: {
                teacherId: teacher.id, subjectId: subject.id, sectionId: sec.id, schoolYear: SCHOOL_YEAR,
              }},
              update: {},
              create: { teacherId: teacher.id, subjectId: subject.id, sectionId: sec.id, schoolYear: SCHOOL_YEAR },
            });
            caCreated++;
          } catch { caSkipped++; }
        }
      }

      console.log(`   Subject ${subject.code}: assigned to ${subjectTeachers.length} teachers across ${allSections.length} sections.`);
    }
  }

  console.log(`   ✔ ClassAssignments created: ${caCreated} (skipped/duplicate: ${caSkipped})\n`);

  // ── 4. Summary ────────────────────────────────────────────────────────────
  const [totalStudents, totalEnrollments, totalCA] = await Promise.all([
    prisma.student.count(),
    prisma.enrollment.count(),
    prisma.classAssignment.count(),
  ]);

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                      IMPORT COMPLETE                     ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Students:           ${String(totalStudents).padEnd(34)}║`);
  console.log(`║  Enrollments:        ${String(totalEnrollments).padEnd(34)}║`);
  console.log(`║  Class Assignments:  ${String(totalCA).padEnd(34)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  NOTE: Class assignments use heuristic distribution.     ║');
  console.log('║  To override with real ATLAS data:                       ║');
  console.log('║    1. Add ATLAS_TOKEN=<enrollpro-jwt> to server/.env     ║');
  console.log('║    2. Re-run: npx tsx import-students.ts                 ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

main()
  .catch(console.error)
  .finally(() => prisma['$disconnect']());
