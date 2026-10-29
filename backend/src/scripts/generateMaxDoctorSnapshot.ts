import * as fs from 'fs';
import * as path from 'path';

interface ExtractedDoctor {
  id: string;
  externalId: string | null;
  hospitalId: string;
  hospitalName: string;
  name: string;
  designation: string;
  specialization: string;
  specialtiesList: string[];
  qualifications?: string;
  experienceYears: number;
  gender: string;
  profileUrl: string;
  imageUrl: string | null;
  sourceUrl: string;
  sourceRetrievedAt: string;
  verificationStatus: string;
  bookingEnabled: boolean;
  contactPhone: string;
  officialBookingUrl: string | null;
}

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function parseAllMaxDoctors(): ExtractedDoctor[] {
  const htmlPath = path.join(__dirname, 'max_nagpur.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // 1. Parse JSON-LD @graph for accurate structured fields
  const jsonLdDoctorsMap = new Map<string, any>();
  const jsonLdRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      if (data['@graph'] && Array.isArray(data['@graph'])) {
        for (const item of data['@graph']) {
          if (item['@type'] === 'Physician' && item.url) {
            jsonLdDoctorsMap.set(item.url.trim(), item);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`Found ${jsonLdDoctorsMap.size} JSON-LD Physician records.`);

  // 2. Parse DOM Cards for designations, experience, and external booking IDs
  const cardParts = html.split('class="doctor-card-new"');
  console.log(`Found ${cardParts.length - 1} DOM doctor cards.`);

  const doctors: ExtractedDoctor[] = [];
  const seenUrls = new Set<string>();

  for (let i = 1; i < cardParts.length; i++) {
    const cardHtml = cardParts[i];

    // Profile URL
    const urlMatch = cardHtml.match(/href="(https:\/\/www\.maxhealthcare\.in\/doctor\/[^"]+)"/i);
    if (!urlMatch) continue;
    const profileUrl = urlMatch[1].trim();

    if (seenUrls.has(profileUrl)) continue;
    seenUrls.add(profileUrl);

    // Name
    const nameMatch = cardHtml.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const domName = nameMatch ? decodeHtml(nameMatch[1].replace(/<[^>]+>/g, '')) : '';

    // Image
    const imgMatch = cardHtml.match(/<img[^>]+class="doctor-img"[^>]+src="([^"]+)"/i);
    const domImage = imgMatch ? imgMatch[1].trim() : null;

    // Designation & Specialties
    const afterH4 = cardHtml.split(/<\/h4>/i)[1] || '';
    const pTags = afterH4.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    const domDesignation = pTags[0] ? decodeHtml(pTags[0].replace(/<[^>]+>/g, '')) : 'Consultant';
    const domSpecialties = pTags[1] ? decodeHtml(pTags[1].replace(/<[^>]+>/g, '')) : '';

    // Experience
    const expMatch = cardHtml.match(/<strong>Experience:\s*<\/strong>\s*(\d+)\+?\s*Years?/i);
    const experienceYears = expMatch ? parseInt(expMatch[1], 10) : 0;

    // Gender
    const genderMatch = cardHtml.match(/<strong>Gender:\s*<\/strong>\s*([^<]+)/i);
    const gender = genderMatch ? genderMatch[1].trim() : 'Unknown';

    // External Max Doctor UUID
    const uuidMatch = cardHtml.match(/\/book-an-appointment\/doctor\/([a-f0-9\-]+)/i);
    const externalId = uuidMatch ? uuidMatch[1] : null;

    // JSON-LD enrichment
    const jsonLd = jsonLdDoctorsMap.get(profileUrl);
    const finalName = domName || jsonLd?.name || 'Dr. Specialist';
    const finalImage = jsonLd?.image || domImage;
    const specialtyText = jsonLd?.medicalSpecialty || domSpecialties || 'General Medicine';
    const specialtiesList = specialtyText.split(',').map((s: string) => s.trim()).filter(Boolean);
    const primarySpecialty = specialtiesList[0] || 'General Medicine';

    // Generate stable deterministic ID
    const slug = profileUrl.split('/doctor/')[1] || `doc-${i}`;
    const id = `doc-max-${slug}`;

    doctors.push({
      id,
      externalId,
      hospitalId: 'fac-max-super-nagpur',
      hospitalName: 'Max Super Speciality Hospital, Nagpur (Formerly Alexis)',
      name: finalName,
      designation: domDesignation,
      specialization: primarySpecialty,
      specialtiesList,
      qualifications: undefined, // Preserving integrity: source does not list qualifications on directory overview card
      experienceYears,
      gender,
      profileUrl,
      imageUrl: finalImage,
      sourceUrl: 'https://www.maxhealthcare.in/doctor/nagpur',
      sourceRetrievedAt: new Date().toISOString(),
      verificationStatus: 'PUBLIC_DIRECTORY_LISTED',
      bookingEnabled: false, // Honest availability: public directory listing, not an integrated partner slot
      contactPhone: '+917127120000',
      officialBookingUrl: externalId ? `https://www.maxhealthcare.in/book-an-appointment/doctor/${externalId}` : profileUrl,
    });
  }

  console.log(`Successfully parsed ${doctors.length} unique Max Healthcare doctors.`);
  return doctors;
}

const docs = parseAllMaxDoctors();

// Ensure output directory exists
const outDir = path.resolve(__dirname, '../../../data/nagpur/doctors');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const outFile = path.join(outDir, 'max_healthcare_nagpur_doctors.json');
fs.writeFileSync(outFile, JSON.stringify(docs, null, 2));
console.log(`Saved snapshot to: ${outFile}`);

// Print breakdown of top specialties
const specMap = new Map<string, number>();
for (const d of docs) {
  for (const s of d.specialtiesList) {
    specMap.set(s, (specMap.get(s) || 0) + 1);
  }
}

console.log('\nTop Doctor Specialities at Max Nagpur:');
Array.from(specMap.entries())
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([spec, count]) => {
    console.log(`  - ${spec}: ${count} doctors`);
  });
