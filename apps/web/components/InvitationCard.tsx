import type { InvitationTemplate } from '../app/lib/invitation-templates';
import { InvitationStitchwork } from './InvitationStitchwork';
import './invitation-card.css';

const motifs = {
  zi_de_nastere: <path d="Te așteptăm cu tort și un toast pentru încă un an." />,
  zi_de_nastere_copii: <path d="Vino să ne jucăm, să râdem și să mâncăm tort!" />,
  petrecere_mireasa: <path d="Te invităm la o după-amiază în cinstea viitoarei mirese." />,
  reinnoire_juraminte: (
    <path d="Vă invităm să ne fiți alături când ne reînnoim jurămintele și să sărbătorim anii petrecuți împreună." />
  ),
  dezvaluire_sex_bebelus: (
    <path d="Vino să afli alături de noi vestea despre bebelușul care urmează să vină." />
  ),
  petrecere_craciun: <path d="Te așteptăm la căldură să sărbătorim Crăciunul împreună." />,
  comemorare: (
    <path d="Vă invităm să ne amintim împreună de o viață dragă și să împărtășim amintiri." />
  ),
  eveniment_networking: (
    <path d="Cunoaște oameni din domeniul tău și fă-ți timp pentru conversații bune." />
  ),
  cina: <path d="M16 12v18q0 6 6 6t6-6V12m-6 0v46m19-40v40m0-40q10-12 10 15H41m17-24v47" />,
  expozitie: <path d="M12 12h56v40H12zm7 7h42v26H19zm3 22 11-12 9 7 8-9 8 14m-7-17h3" />,
  concert: (
    <path d="M32 46V17l25-6v32M32 24l25-6M20 53c-2-5 3-10 12-10v5c0 7-10 10-12 5Zm25-4c-2-5 3-10 12-10v5c0 7-10 10-12 5Z" />
  ),
  atelier: <path d="M16 52 23 33 53 7l12 13-31 27-18 5Zm7-19 11 14M47 12l12 13M14 58h50" />,
  turneu_sportiv: (
    <path d="M24 11h32v12c0 12-6 19-16 19S24 35 24 23V11Zm0 7H12c0 12 5 17 15 17m29-17h12c0 12-5 17-15 17M40 42v10m-14 4h28" />
  ),
  pensionare: (
    <path d="M10 44h60M19 44a21 21 0 0 1 42 0M40 8v9M15 15l8 8m42-8-8 8M18 50h44m-37 6h30" />
  ),
  festivitate_premii: <path d="m40 9 8 15 17 3-12 12 2 17-15-8-15 8 2-17-12-12 17-3 8-15Z" />,
  festival: <path d="M9 15q31 22 62 0m-56 4 5 20 11-14m4 2 6 20 7-21m7-2 12 14 4-23" />,
  absolvire: <path d="M10 26 40 12l30 14-30 14-30-14Zm12 7v13q18 14 36 0V33m8-4v19m-3 4h6" />,
  logodna: (
    <path d="M40 52 16 29C5 16 23 6 32 16l8 9 8-9c9-10 27 0 16 13L40 52Zm25-43v10m-5-5h10" />
  ),
  petrecere_bebelus: (
    <path d="M40 11a22 22 0 1 0 21 33C40 48 29 30 40 11Zm16 8 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" />
  ),
  inaugurare_casa: <path d="M10 31 40 9l30 22M17 27v27h46V27M34 54V37h12v17M48 17V9h8v14" />,
  conferinta: (
    <path d="M23 40h34v14H23V40Zm-7 14h48M36 40V26l12-8m-2-3 8-5 5 8-8 5-5-8ZM14 21h7m-4-4v8" />
  ),
  lansare: (
    <path d="m20 48 8-19 25-17 13-1-1 13-17 25-19 8 4-13-13 4Zm12-8 10 10m8-23 4-4m-35 22-8 8m7-1-4 9" />
  ),
  gala_caritabila: (
    <path d="M40 12c1 10 7 16 17 18-10 1-16 7-17 17-1-10-7-16-17-17 10-2 16-8 17-18ZM11 45c10 1 16 5 19 12m39-12c-10 1-16 5-19 12M12 35l7 4m49-4-7 4" />
  ),
  reuniune: (
    <path d="M16 16h48v35H16V16Zm6 27 13-13 9 8 6-6 8 11M14 57h52M12 22h-4v32m60-36h4v34M48 23h5" />
  ),
  picnic: (
    <>
      <path d="M12 52C29 50 43 35 62 12M31 44c-14-1-20-8-17-18 12 0 19 5 17 18Zm12-10c1-14 7-23 18-23 1 11-4 19-18 23Zm-5 7c13-7 23-6 29 2-8 7-17 7-29-2Z" />
      <circle cx="67" cy="32" r="2" />
    </>
  ),
  aniversare: (
    <>
      <path d="M23 35h34v20H23zm-4 20h42M23 41q4 8 8 0 4 8 9 0 4 8 9 0 4 8 8 0M40 35V24m0-3c-8 0-4-8 1-13 4 8 7 13-1 13ZM12 21h8m-4-4v8m44 1h8m-4-4v8" />
    </>
  ),
  nunta: (
    <>
      <circle cx="31" cy="37" r="16" />
      <circle cx="49" cy="37" r="16" />
      <path d="m20 21 5-8h12l5 8m-17-8 6 8 6-8M49 8v7m-4-3h8" />
    </>
  ),
  botez: (
    <>
      <path d="M12 44c0-7 7-11 13-10 1-9 8-15 17-15 8 0 15 6 16 14 7 0 12 5 12 11 0 6-5 10-11 10H23c-7 0-11-4-11-10Zm22-6 6 6 7-8M58 6v11m-5-5h10M19 15v8m-4-4h8" />
    </>
  ),
  revelion: (
    <>
      <path d="M40 7v13m0 23v13M15 32h13m24 0h13M21 13l9 9m20 20 9 9M21 51l9-9m20-20 9-9" />
      <circle cx="40" cy="32" r="8" />
      <circle cx="64" cy="22" r="2" />
      <circle cx="17" cy="43" r="2" />
    </>
  ),
  voiaj_solo: (
    <>
      <circle cx="40" cy="32" r="24" />
      <path d="m52 19-5 20-20 7 7-20 18-7Zm-18 7 13 13M40 3v9m0 40v9M11 32h9m40 0h9" />
    </>
  ),
  voiaj_grup: (
    <>
      <path d="M10 52 27 29l9 10 14-26 20 39H10Zm13-17 5 4 5-4m11-12 6 5 6-5M17 16c5-4 9-4 14 0m-9 6c4-3 8-3 12 0" />
      <circle cx="64" cy="15" r="4" />
    </>
  ),
  custom: (
    <>
      <path d="M40 6c0 15 9 25 24 26-15 2-24 12-24 26 0-14-10-24-24-26C30 31 40 21 40 6Z" />
      <path d="M61 11v14m-7-7h14M19 43v14m-7-7h14" />
      <circle cx="40" cy="32" r="4" />
    </>
  ),
};

const stitchPlacements: Partial<Record<string, 'top' | 'bottom' | 'sidebar'>> = {
  'muscel-sleeve-steps': 'sidebar',
  'bucovina-hooked-cross': 'top',
  'bucovina-branching-flower': 'bottom',
  'rasinari-end-register': 'top',
  'rasinari-stripe-rhythm': 'sidebar',
  'moldova-stepped-wave': 'bottom',
  'oltenia-floral-scoarta': 'top',
};

const textileAccent: Record<string, string> = {
  'muscel-altita':
    'M6 16h88m-88 4h88M6 87h88m-88 4h88m-76-78 5-4 5 4-5 4Zm27 0 5-4 5 4-5 4Zm27 0 5-4 5 4-5 4Z',
  'muscel-rauri': 'M7 8v84m6-84v84m74-84v84m6-84v84M17 12h8m-8 76h8m50-76h8m-8 76h8',
  'maramures-ciupag':
    'M4 8h92M4 21h92m-92 65h92M4 91h92M10 14l5-3 5 3-5 3Zm20 0 5-3 5 3-5 3Zm20 0 5-3 5 3-5 3Zm20 0 5-3 5 3-5 3Z',
  'sibiu-fodori':
    'M5 16q5-4 10 0t10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0M5 84q5 4 10 0t10 0 10 0 10 0 10 0 10 0 10 0 10 0 10 0',
  'moldova-sirlau': 'M5 4h20v92H5ZM9 4v92m12-92v92',
  'dobrogea-stergar':
    'M3 7h94M3 13h94M3 88h94M3 94h94m-92 3v3m6-3v3m6-3v3m6-3v3m54-3v3m6-3v3m6-3v3m6-3v3',
  'oltenia-scoarta':
    'M5 22V5h90v17M5 78v17h90V78M9 18v-9h82v9M9 82v9h82v-9M50 96V81m0 9q-9-1-10-6 7 0 10 6m0 0q9-1 10-6-7 0-10 6',
  'moldova-romburi':
    'M5 15h90m-90 70h90M27 11l3-3 3 3-3 3Zm20 0 3-3 3 3-3 3Zm20 0 3-3 3 3-3 3ZM27 90l3-3 3 3-3 3Zm20 0 3-3 3 3-3 3Zm20 0 3-3 3 3-3 3Z',
};

const editionArtwork: Record<string, string> = {
  'muscel-altita':
    'M7 6h86M7 22h86M7 84h86M7 94h86M12 8l4 3-4 3-4-3Zm17 0 4 3-4 3-4-3Zm17 0 4 3-4 3-4-3Zm17 0 4 3-4 3-4-3Zm17 0 4 3-4 3-4-3ZM12 89l5-4 5 4-5 4Zm22 0 5-4 5 4-5 4Zm22 0 5-4 5 4-5 4Zm22 0 5-4 5 4-5 4Z',
  'muscel-rauri':
    'M19 8l5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5ZM81 8l5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Zm0 18 5 5-5 5-5-5Z',
  'maramures-ciupag':
    'M4 9h92v11H4ZM8 19l6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8 6-8 6 8M9 94h82',
  'sibiu-fodori':
    'M6 12h88m-88 76h88m-90-65v54m92-54v54M9 30l5 4-5 4-5-4Zm0 16 5 4-5 4-5-4Zm0 16 5 4-5 4-5-4ZM91 30l5 4-5 4-5-4Zm0 16 5 4-5 4-5-4Zm0 16 5 4-5 4-5-4Z',
  'moldova-sirlau':
    'M6 6h2v4h4v4h4v4h4v4h3m0 1h-3v4h-4v4h-4v4H8v4H6m0 1h2v4h4v4h4v4h4v4h3m0 1h-3v4h-4v4h-4v4H8v4H6m0 1h2v4h4v4h4v4h4v4h3',
  'dobrogea-stergar':
    'M8 17q9-9 18 0t18 0 18 0 18 0 12 0M8 83q9 9 18 0t18 0 18 0 18 0 12 0M16 17l-3 7m5-7 3 7m31-7-3 7m5-7 3 7m31-7-3 7m5-7 3 7',
  'oltenia-scoarta':
    'M15 18q9-10 21-3l6 4-6 3q-9 2-13-3l-6 5m68-6q-9-10-21-3l-6 4 6 3q9 2 13-3l6 5M44 17h12l-3 6h-6Zm4 6v4m-3 0h6M15 81q8 3 13-2m57 2q-8 3-13-2',
  'moldova-romburi':
    'M4 8h4V5h5V2h5v3h5v3h4v4h-4v3h-5v3h-5v-3H8v-3H4Zm69 0h4V5h5V2h5v3h5v3h4v4h-4v3h-5v3h-5v-3h-5v-3h-4ZM4 88h4v-3h5v-3h5v3h5v3h4v4h-4v3h-5v3h-5v-3H8v-3H4Zm69 0h4v-3h5v-3h5v3h5v3h4v4h-4v3h-5v3h-5v-3h-5v-3h-4Z',
  // New linework interpreted from the museum and heritage references in docs/design/romanian-invitations.md.
  'maramures-gate':
    'M8 98V39Q8 9 50 9t42 30v59M12 98V39q0-26 38-26t38 26v59M8 61l4 5-4 5 4 5-4 5 4 5-4 5m80-30 4 5-4 5 4 5-4 5 4 5-4 5M50 20v9m-6-4h12',
  'maramures-rosette':
    'M3 15h94M3 85h94M50 8l2 3 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1ZM50 78l2 3 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1ZM7 20v60m86-60v60',
  'bucovina-wax':
    'M4 11h92M4 20h92m-91-5 5-4 5 4-5 4-5-4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4Zm10 0 5-4 5 4-5 4ZM4 91h92m-92 4h92',
  'bucovina-lozenge':
    'M3 28 13 15 3 2m4 26 10-13L7 2m90 26L87 15 97 2m-4 26L83 15 93 2M3 98l10-13L3 72m4 26 10-13L7 72m90 26L87 85l10-13m-4 26L83 85l10-13M45 6l5-4 5 4-5 4Zm0 88 5-4 5 4-5 4Z',
  'horezu-clay':
    'M0 16C17 5 38 5 50 13S82 21 100 8M0 20C17 9 38 9 50 17S82 25 100 12M6 90q27-8 44 0t44 0M6 94q27-8 44 0t44 0M5 10c10 0 10-9 3-8-4 0-5 4-2 4m89 6c-10 0-10-9-3-8 4 0 5 4 2 4',
  'horezu-medallion':
    'M50 3a45 47 0 1 0 0 94 45 47 0 1 0 0-94Zm0 4a41 43 0 1 0 0 86 41 43 0 1 0 0-86ZM2 12q20-2 13-9c-6-5-10 4-4 4m87 5Q78 10 85 3c6-5 10 4 4 4M2 88q20 2 13 9c-6 5-10-4-4-4m87-5q-20 2-13 9c6 5 10-4 4-4',
  'saxon-chest':
    'M6 8h19v84H6ZM8 13h15v74H8Zm8 60V31q7-10 0-14-7 4 0 14Zm0-14q-9-3-8-11 8 1 8 11Zm0-9q9-3 8-11-8 1-8 11ZM32 90h62m-62 4h62',
  'saxon-floral':
    'M5 35V5h90v30M5 65v30h90V65M11 21q9 0 13-10-11-1-13 10Zm0 0q11 1 16 8-10 2-16-8Zm78 0q-9 0-13-10 11-1 13 10Zm0 0q-11 1-16 8 10 2 16-8ZM50 93V85m0 4q-10-2-9-8 7 0 9 8Zm0 0q10-2 9-8-7 0-9 8Z',
  'wildflower-edition':
    'M2 100Q29 94 26 58m-12 37Q9 83 3 80q1 11 11 15m4-5q16-8 18-18-11 2-18 18m8-26c-11-6-7-14-1-8 4-10 11-4 6 2 10 4 4 11-5 6ZM98 100Q75 94 77 70m9 25q7-13 13-11-3 8-13 11m-6-7q-13-3-16-12 9 1 16 12M77 73c-8-2-8-10-2-6 3-8 9-3 6 1 7 3 3 8-4 5Z',
  'woodcut-edition':
    'M0 24q13-8 33-4t34 0 33-4M0 27q18-8 35-4t31 0 34-4M0 30q18-8 35-4t31 0 34-4M0 33q18-8 35-4t31 0 34-4M0 36q18-8 35-4t31 0 34-4',
  'woven-edition':
    'M8 2v96m3-96v96m4-96v96m4-96v96M4 14h20M4 28h20M4 42h20M4 56h20M4 70h20M4 84h20M6 7l16 14L6 35l16 14L6 63l16 14L6 91',
  'damask-edition':
    'M4 24Q17 22 20 6C14 16 7 9 12 6q9-6 12 6m-20 2Q9 5 16 4m80 20Q83 22 80 6c6 10 13 3 8 0q-9-6-12 6m20 2Q91 5 84 4M4 76q13 2 16 18c-6-10-13-3-8 0q9 6 12-6m72-12q-13 2-16 18c6-10 13-3 8 0q-9 6-12-6',
  'heraldic-edition':
    'M6 30V16Q22 16 28 6H72q6 10 22 10v14M6 70v14q16 0 22 10H72q6-10 22-10V70M10 31V19q13-2 20-9H70q7 7 20 9v12M10 69v12q13 2 20 9H70q7-7 20-9V69',
  'embroidered-edition':
    'M5 6l5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4M5 94l5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4 5-4 5 4',
  'letterpress-edition':
    'M6 24V6h18m52 0h18v18M6 76v18h18m52 0h18V76M10 18q0-8 8-8m64 0q8 0 8 8M10 82q0 8 8 8m64 0q8 0 8-8',
  'botanical-edition':
    'M3 98Q38 65 18 33Q0 12 13 0M14 79Q2 63 3 48Q18 54 14 79ZM22 63Q37 56 40 41Q22 44 22 63ZM18 43Q6 44 1 29Q13 28 18 43ZM20 35Q35 25 29 10Q19 19 20 35ZM97 2Q62 35 82 67Q100 88 87 100M86 21Q98 37 97 52Q82 46 86 21ZM78 37Q63 44 60 59Q78 56 78 37ZM82 57Q94 56 99 71Q87 72 82 57ZM80 65Q65 75 71 90Q81 81 80 65Z',
  'deco-edition':
    'M0 38 38 0m-38 47 47-47M0 28 28 0m44 0 28 28M62 0l38 38M53 0l47 47M0 62l38 38M0 53l47 47M0 72l28 28m44 0 28-28M62 100l38-38m-47 38 47-47',
  'modernist-edition': 'M12 0v100m6-100v100M0 24h21M0 76h21',
  'folded-edition': 'M0 0l50 37L100 0M0 100l50-27 50 27M0 2l50 37 50-37',
  'engraved-edition':
    'M13 50C13 19 80 7 87 50S13 81 13 50ZM13 50C13 81 80 93 87 50S13 19 13 50ZM21 50c0-43 58-43 58 0s-58 43-58 0Z',
};

export function InvitationCard({
  template,
  title,
  text,
  detail,
  thumbnail = false,
}: {
  template: InvitationTemplate;
  title: string;
  text: string;
  detail?: string;
  thumbnail?: boolean;
}) {
  if (template.range === 'embroidery') {
    const placement = stitchPlacements[template.composition] ?? 'frame';
    return (
      <span
        className={
          'invitation-card invitation-embroidered' + (thumbnail ? ' invitation-thumbnail' : '')
        }
        data-palette={template.palette}
        data-composition={template.composition}
        data-stitch-placement={placement}
        aria-hidden={thumbnail || undefined}
      >
        {placement !== 'bottom' && (
          <InvitationStitchwork motif={template.composition} vertical={placement === 'sidebar'} />
        )}
        <span className="invitation-copy">
          <span className="invitation-heading">{title}</span>
          {text && <span className="invitation-message">{text}</span>}
          {detail && <span className="invitation-detail">{detail}</span>}
        </span>
        {(placement === 'frame' || placement === 'bottom') && (
          <InvitationStitchwork motif={template.composition} />
        )}
      </span>
    );
  }
  return (
    <span
      className={'invitation-card' + (thumbnail ? ' invitation-thumbnail' : '')}
      data-palette={template.palette}
      data-composition={template.composition}
      data-edition={editionArtwork[template.composition] ? '' : undefined}
      aria-hidden={thumbnail || undefined}
    >
      {editionArtwork[template.composition] && (
        <svg
          className="invitation-edition-art"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={editionArtwork[template.composition]} vectorEffect="non-scaling-stroke" />
          {textileAccent[template.composition] && (
            <path
              className="invitation-textile-accent"
              d={textileAccent[template.composition]}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
      <svg
        className="invitation-motif"
        viewBox="0 0 80 64"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {motifs[template.kind]}
      </svg>
      <span className="invitation-copy">
        <span className="invitation-heading">{title}</span>
        {text && <span className="invitation-message">{text}</span>}
        {detail && <span className="invitation-detail">{detail}</span>}
      </span>
    </span>
  );
}
