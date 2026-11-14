import type { TemplateKind } from '@eventdesk/core';

export const invitationCompositions = [
  'frame',
  'arch',
  'seal',
  'ribbon',
  'band',
  'ticket',
  'postcard',
  'split',
  'crest',
  'border',
  'triptych',
  'medallion',
  'rays',
  'diagonal',
  'plaque',
  'column',
  'scallop',
  'imprint',
  'ruling',
  'duotone',
] as const;

export const additionalOccasionKinds = [
  'absolvire',
  'logodna',
  'petrecere_bebelus',
  'inaugurare_casa',
  'conferinta',
  'lansare',
  'gala_caritabila',
  'reuniune',
  'cina',
  'expozitie',
  'concert',
  'atelier',
  'turneu_sportiv',
  'pensionare',
  'festivitate_premii',
  'festival',
  'zi_de_nastere',
  'zi_de_nastere_copii',
  'petrecere_mireasa',
  'reinnoire_juraminte',
  'dezvaluire_sex_bebelus',
  'petrecere_craciun',
  'comemorare',
  'eveniment_networking',
] as const;

const collections = {
  picnic: ['orchard', 'gingham', 'meadow', 'citrus', 'lakeside'],
  aniversare: ['confetti', 'candle', 'sorbet', 'disco', 'sprinkles'],
  nunta: ['silk', 'olive', 'heirloom', 'porcelain', 'vellum'],
  botez: ['cloud', 'lullaby', 'nest', 'lamb', 'petal'],
  revelion: ['champagne', 'fireworks', 'frost', 'emerald', 'velvet'],
  voiaj_solo: ['compass', 'sunrise', 'atlas', 'horizon', 'desert'],
  voiaj_grup: ['railway', 'postmark', 'summit', 'harbour', 'caravan'],
  custom: ['paper', 'ink', 'terrace', 'studio', 'gallery'],
  absolvire: ['laurel', 'tassel', 'diploma', 'honours', 'campus'],
  logodna: ['blush', 'promise', 'pearl', 'vow', 'bouquet'],
  petrecere_bebelus: ['moon', 'cotton', 'mint', 'apricot', 'starlight'],
  inaugurare_casa: ['hearth', 'doorstep', 'brick', 'linen', 'woodgrain'],
  conferinta: ['keynote', 'graphite', 'signal', 'grid', 'forum'],
  lansare: ['spotlight', 'spectrum', 'chrome', 'prototype', 'neon'],
  gala_caritabila: ['gilded', 'sapphire', 'patron', 'orchid', 'onyx'],
  reuniune: ['album', 'postscript', 'heritage', 'copper', 'evergreen'],
  cina: ['saffron', 'merlot', 'stoneware', 'fig', 'tablecloth'],
  expozitie: ['gesso', 'canvas', 'patina', 'matboard', 'lacquer'],
  concert: ['backstage', 'encore', 'soundcheck', 'vinyl', 'amp'],
  atelier: ['notebook', 'pigment', 'workbench', 'pencil', 'indigo-dye'],
  turneu_sportiv: ['track', 'court', 'turf', 'scoreboard', 'relay'],
  pensionare: ['afterglow', 'sundial', 'parchment', 'amber', 'seaglass'],
  festivitate_premii: ['statuette', 'marquee', 'platinum', 'applause', 'laureate'],
  festival: ['bunting', 'lantern', 'parade', 'daybreak', 'fairground'],
  zi_de_nastere: ['truffle', 'vermilion', 'sparkler', 'nightshade', 'peach'],
  zi_de_nastere_copii: ['jellybean', 'crayon', 'balloon', 'lemonade', 'gumdrop'],
  petrecere_mireasa: ['peony', 'organza', 'gardenia', 'rhubarb', 'primrose'],
  reinnoire_juraminte: ['ribbon-silk', 'rosewood', 'quartz', 'patinated-brass', 'mist'],
  dezvaluire_sex_bebelus: ['sugarplum', 'buttermilk', 'morning-sky', 'bubblegum', 'pistachio'],
  petrecere_craciun: ['holly', 'cranberry', 'snowfall', 'spruce', 'tinsel'],
  comemorare: ['willow', 'remembrance', 'soft-stone', 'white-rose', 'stillwater'],
  eveniment_networking: ['blueprint', 'type-metal', 'copperplate', 'sea-ink', 'newsprint'],
} as const satisfies Record<
  TemplateKind | 'custom' | (typeof additionalOccasionKinds)[number],
  readonly string[]
>;

const wordingCompositions = invitationCompositions.slice(0, 10);
const studioPalettes = ['alabaster', 'celadon', 'mulberry', 'lapis', 'marigold'] as const;
const signatureEditions = [
  ['letterpress-edition', 0, 'frame'],
  ['botanical-edition', 2, 'arch'],
  ['deco-edition', 1, 'crest'],
  ['modernist-edition', 3, 'split'],
  ['folded-edition', 4, 'ribbon'],
  ['engraved-edition', 2, 'seal'],
] as const;
const themedEditions = {
  rustic: [
    ['wildflower-edition', 'harvest-linen', 'arch'],
    ['woodcut-edition', 'orchard-bark', 'ribbon'],
    ['woven-edition', 'oat-cloth', 'split'],
    ['maramures-gate', 'maramures-oak', 'ribbon'],
    ['bucovina-wax', 'bucovina-wax', 'arch'],
    ['horezu-clay', 'horezu-clay', 'seal'],
    ['saxon-chest', 'saxon-chest', 'split'],
    ['muscel-altita', 'muscel-thread', 'arch'],
    ['maramures-ciupag', 'ciupag-thread', 'ribbon'],
    ['moldova-sirlau', 'moldova-wool', 'split'],
    ['dobrogea-stergar', 'dobrogea-cotton', 'frame'],
  ],
  traditional: [
    ['damask-edition', 'antique-ivory', 'frame'],
    ['heraldic-edition', 'heritage-blue', 'crest'],
    ['embroidered-edition', 'heirloom-red', 'seal'],
    ['maramures-rosette', 'maramures-ink', 'crest'],
    ['bucovina-lozenge', 'bucovina-red', 'frame'],
    ['horezu-medallion', 'horezu-glaze', 'seal'],
    ['saxon-floral', 'saxon-blue', 'frame'],
    ['muscel-rauri', 'muscel-thread', 'frame'],
    ['sibiu-fodori', 'sibiu-cloth', 'crest'],
    ['oltenia-scoarta', 'dolj-wool', 'seal'],
    ['moldova-romburi', 'moldova-diamond', 'frame'],
  ],
} as const;

const embroideredEditions = {
  'muscel-sleeve-steps': 'arch',
  'muscel-gold-lattice': 'frame',
  'bucovina-hooked-cross': 'crest',
  'bucovina-branching-flower': 'seal',
  'bucovina-diamond-chain': 'ticket',
  'rasinari-end-register': 'ribbon',
  'rasinari-stripe-rhythm': 'split',
  'moldova-stepped-wave': 'postcard',
  'moldova-woven-diamonds': 'border',
  'oltenia-floral-scoarta': 'band',
  'muscel-check': 'frame',
  'muscel-altita-grid': 'arch',
  'comanesti-diamond': 'crest',
  'comanesti-sprig': 'seal',
  'rasinari-woven': 'split',
  'dolj-woven': 'ribbon',
} as const;
type EmbroideredEdition = keyof typeof embroideredEditions;

export const invitationRanges = [
  'embroidery',
  'featured',
  'rustic',
  'traditional',
  'all_designs',
] as const;

export type InvitationKind = keyof typeof collections;
export type InvitationComposition = (typeof invitationCompositions)[number];

export function invitationKind(kind: string): InvitationKind {
  return Object.hasOwn(collections, kind) ? (kind as InvitationKind) : 'custom';
}

export function invitationTemplates(kind: string) {
  const collection = invitationKind(kind);
  const featured = signatureEditions.map(([composition, paletteIndex, wording]) => {
    const palette = collections[collection][paletteIndex]!;
    return {
      id: collection + '.' + palette + '.' + composition,
      kind: collection,
      palette,
      composition,
      wording,
      featured: true,
      range: 'featured' as const,
    };
  });
  const library = [...collections[collection], ...studioPalettes].flatMap((palette) =>
    invitationCompositions.map((composition, index) => ({
      id: collection + '.' + palette + '.' + composition,
      kind: collection,
      palette,
      composition,
      wording: wordingCompositions[index % wordingCompositions.length]!,
      featured: false,
      range: 'all_designs' as const,
    }))
  );
  const themed = (['rustic', 'traditional'] as const).flatMap((range) =>
    themedEditions[range].map(([composition, palette, wording]) => ({
      id: collection + '.' + palette + '.' + composition,
      kind: collection,
      palette,
      composition,
      wording,
      featured: false,
      range,
    }))
  );
  const embroidered = (Object.keys(embroideredEditions) as EmbroideredEdition[]).map(
    (composition) => ({
      id: collection + '.stitched-linen.' + composition,
      kind: collection,
      palette: 'stitched-linen',
      composition,
      wording: embroideredEditions[composition],
      featured: false,
      range: 'embroidery' as const,
    })
  );
  return [...embroidered, ...featured, ...themed, ...library];
}

export type InvitationTemplate = ReturnType<typeof invitationTemplates>[number];

export function findInvitationTemplate(id: string) {
  return invitationTemplates(id.split('.')[0] ?? '').find((template) => template.id === id);
}
