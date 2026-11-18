import type { Mode } from './types';

// Rolling stock in service on each target line (French Wikipedia line pages, November 2026). Drawing parameters
// and liveries were read from real side or three-quarter photos; each photo's author and licence are copied from
// the Wikimedia Commons API (extmetadata), never written by hand. Lines in transition list several models, main one
// first: the realtime feed never says which one is running.

export type NoseShape = 'rounded' | 'flat' | 'sloped' | 'tram';

/** Livery colours (hex): body, window band, skirt (lower body), front mask, window glass, doors. */
export interface Livery { body: string; band: string; skirt: string; front: string; window: string; door: string }

/** A free-licence Commons photo: thumbnail (upload.wikimedia.org), file page, author and licence as Commons gives them. */
export interface StockPhoto { url: string; page: string; author: string; license: string }

export interface RollingStockModel {
  id: string;
  name: string;
  mode: Mode;
  /** Cars in one unit as it runs on the line. */
  cars: number;
  levels: 1 | 2;
  /** Doors per side and per car. */
  doorsPerCar: number;
  nose: NoseShape;
  livery: Livery;
  photo: StockPhoto | null;
  /** Units usually coupled when the feed gives no length (e.g. RER A/B always run as two units). */
  defaultUnits?: 1 | 2;
  /** Side-view drawing (public/ path) shown instead of the generated profile. */
  sprite?: string;
}

const GLASS = '#1b2230';
/** Black front mask (Île-de-France Mobilités stock, framed in sky blue on the photos; MI 2N). */
const MASK = '#1c232b';

const LIVERIES = {
  /** STIF / RATP: white body, green-teal band and doors, grey skirt (MP 05, MF 88, MI 09, MI 84). */
  stif: { body: '#f2f4f5', band: '#00a88e', skirt: '#5b6670', front: '#26323a', window: GLASS, door: '#00a88e' },
  /** Same scheme with teal doors, a teal waist line and a darker front (MF 01, renovated MF 67). */
  stifDoors: { body: '#f2f4f5', band: '#00a88e', skirt: '#4f5962', front: '#1f272d', window: GLASS, door: '#00a88e' },
  /** MP 89 CC: white lower body under a teal waist band, dark window strip and dark doors, black front. */
  mp89cc: { body: '#f2f4f5', band: '#00a88e', skirt: '#e6e9ec', front: '#1b2026', window: GLASS, door: '#30373d' },
  /** Île-de-France Mobilités, RATP stock: white body, sky-blue roof line and front frame, mid-grey lower band,
   * black front mask, white doors (MP 14, MF 77, MP 89 CA). */
  idfmBlue: { body: '#eef1f4', band: '#2f8fd8', skirt: '#7d868f', front: MASK, window: GLASS, door: '#d5dbe1' },
  /** MF 19: white body, blue front frame, grey skirt, black front mask, white doors. */
  mf19: { body: '#eef1f4', band: '#2a5fb5', skirt: '#5a636c', front: MASK, window: GLASS, door: '#d5dbe1' },
  /** RATP RER (MI 2N Altéo): white body, red band along the upper deck, dark blue lower band, black front mask. */
  ratpRer: { body: '#f4f5f6', band: '#e2231a', skirt: '#1d3e8c', front: MASK, window: GLASS, door: '#d3d7dc' },
  /** Renovated MI 79: white body and front, teal, magenta and blue stripes at the car ends, light grey doors. */
  mi79: { body: '#f4f5f6', band: '#00a88e', skirt: '#2c3b8f', front: '#d9dde2', window: GLASS, door: '#cfd5db' },
  /** SNCF Transilien « Carmillon »: white body, carmine doors and front frame, black front mask, grey skirt
   * (Z 5600, Z 8800). */
  carmillon: { body: '#eef0f2', band: '#a3004f', skirt: '#4a4f57', front: '#1e2228', window: GLASS, door: '#a3004f' },
  /** Île-de-France Mobilités, SNCF stock: white and grey body, sky-blue band and doors, black front mask, dark skirt. */
  idfmSncf: { body: '#eef1f4', band: '#3a95d8', skirt: '#2c343c', front: MASK, window: GLASS, door: '#3a95d8' },
  /** Early Transilien (AGC): white body, blue front and band, green flash, red doors. */
  transilien: { body: '#f5f6f7', band: '#1e50a0', skirt: '#9aa3ad', front: '#1e50a0', window: GLASS, door: '#c8102e' },
  /** RATP trams (Citadis 302/402, Translohr): white body, teal band, grey skirt, dark glazed doors. */
  ratpTram: { body: '#f3f5f6', band: '#00a88e', skirt: '#8a949c', front: '#f3f5f6', window: GLASS, door: '#3c464f' },
  /** Île-de-France Mobilités trams and tram-trains: white body, sky-blue band, grey lower body, black front mask. */
  idfmTram: { body: '#f2f4f6', band: '#3a95d8', skirt: '#9aa3ad', front: MASK, window: GLASS, door: '#c9d0d7' },
  /** Citadis Dualis U 53600 (T11, T14): white and silver body, magenta front frame, black front mask. */
  dualisMagenta: { body: '#eceff2', band: '#d6246e', skirt: '#9aa3ad', front: MASK, window: GLASS, door: '#c9d0d7' },
} satisfies Record<string, Livery>;

export const MODELS: Record<string, RollingStockModel> = {
  'mp05': {
    id: 'mp05', sprite: '/rolling-stock/mp05.png', name: 'MP 05', mode: 'metro', cars: 6, levels: 1, doorsPerCar: 3, nose: 'rounded', livery: LIVERIES.stif,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/MP05_RATP_STIF_Esplanade.jpg/500px-MP05_RATP_STIF_Esplanade.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MP05_RATP_STIF_Esplanade.jpg',
      author: 'Momo Ratp',
      license: 'CC BY-SA 4.0',
    },
  },
  'mf01': {
    id: 'mf01', sprite: '/rolling-stock/mf01.png', name: 'MF 01', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 3, nose: 'rounded', livery: LIVERIES.stifDoors,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d2/141012_Paris_Stalingrad_IMG_5848.JPG/500px-141012_Paris_Stalingrad_IMG_5848.JPG',
      page: 'https://commons.wikimedia.org/wiki/File:141012_Paris_Stalingrad_IMG_5848.JPG',
      author: 'Roehrensee',
      license: 'CC BY-SA 4.0',
    },
  },
  'mf67': {
    id: 'mf67', sprite: '/rolling-stock/mf67.png', name: 'MF 67', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 4, nose: 'flat', livery: LIVERIES.stifDoors,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/MF67_RATP_Ligne_12.jpg/500px-MF67_RATP_Ligne_12.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MF67_RATP_Ligne_12.jpg',
      author: 'Mohamed SY',
      license: 'CC BY-SA 4.0',
    },
  },
  'mf67-3': {
    id: 'mf67-3', sprite: '/rolling-stock/mf67.png', name: 'MF 67', mode: 'metro', cars: 3, levels: 1, doorsPerCar: 4, nose: 'flat', livery: LIVERIES.stifDoors,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/MF67_D_RATP_14023_14093.jpg/500px-MF67_D_RATP_14023_14093.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MF67_D_RATP_14023_14093.jpg',
      author: 'Mohamed SY (Momo RATP)',
      license: 'CC BY-SA 4.0',
    },
  },
  'mp89-ca': {
    id: 'mp89-ca', sprite: '/rolling-stock/mp89.png', name: 'MP 89 CA', mode: 'metro', cars: 6, levels: 1, doorsPerCar: 3, nose: 'rounded', livery: LIVERIES.idfmBlue,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Cit%C3%A9_%28Paris_m%C3%A9tro%29_MP_89_CA_01.jpg/500px-Cit%C3%A9_%28Paris_m%C3%A9tro%29_MP_89_CA_01.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Cit%C3%A9_(Paris_m%C3%A9tro)_MP_89_CA_01.jpg',
      author: 'Ismaël 1996',
      license: 'CC BY-SA 4.0',
    },
  },
  'mp89-cc': {
    id: 'mp89-cc', sprite: '/rolling-stock/mp89.png', name: 'MP 89 CC', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 3, nose: 'rounded', livery: LIVERIES.mp89cc,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/33/MP_89_ligne_6.jpg/500px-MP_89_ligne_6.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MP_89_ligne_6.jpg',
      author: 'Adnane',
      license: 'CC BY-SA 4.0',
    },
  },
  'mf77': {
    id: 'mf77', sprite: '/rolling-stock/mf77.png', name: 'MF 77', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 3, nose: 'flat', livery: LIVERIES.idfmBlue,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/55/MF77_085_Censier-Daubenton.jpg/500px-MF77_085_Censier-Daubenton.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MF77_085_Censier-Daubenton.jpg',
      author: 'Bmazerolles',
      license: 'CC BY 4.0',
    },
  },
  'mf88': {
    id: 'mf88', sprite: '/rolling-stock/mf88.png', name: 'MF 88', mode: 'metro', cars: 3, levels: 1, doorsPerCar: 3, nose: 'flat', livery: LIVERIES.stif,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/MF_88_at_Pr%C3%A9_Saint-Gervais_Station%2C_Paris_19e_20140427.jpg/500px-MF_88_at_Pr%C3%A9_Saint-Gervais_Station%2C_Paris_19e_20140427.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MF_88_at_Pr%C3%A9_Saint-Gervais_Station,_Paris_19e_20140427.jpg',
      author: 'DXR',
      license: 'CC BY-SA 3.0',
    },
  },
  'mf19': {
    id: 'mf19', sprite: '/rolling-stock/mf19.png', name: 'MF 19', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 3, nose: 'sloped', livery: LIVERIES.mf19,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/MF_19_n%C2%B0006_-_Od%C3%A9on.jpg/500px-MF_19_n%C2%B0006_-_Od%C3%A9on.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MF_19_n%C2%B0006_-_Od%C3%A9on.jpg',
      author: 'Bmazerolles',
      license: 'CC BY 4.0',
    },
  },
  'mp14-cc': {
    id: 'mp14-cc', sprite: '/rolling-stock/mp14.png', name: 'MP 14 CC', mode: 'metro', cars: 5, levels: 1, doorsPerCar: 3, nose: 'sloped', livery: LIVERIES.idfmBlue,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4e/MP_14_-_Coteaux_Beauclair_%281%29.jpg/500px-MP_14_-_Coteaux_Beauclair_%281%29.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MP_14_-_Coteaux_Beauclair_(1).jpg',
      author: 'Capitaine AdBlock',
      license: 'CC0',
    },
  },
  'mp14-ca-6': {
    id: 'mp14-ca-6', sprite: '/rolling-stock/mp14.png', name: 'MP 14 CA', mode: 'metro', cars: 6, levels: 1, doorsPerCar: 3, nose: 'sloped', livery: LIVERIES.idfmBlue,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/da/MP_14_CA_51_%C3%A0_Cit%C3%A9_%28Ligne_4%29.jpg/500px-MP_14_CA_51_%C3%A0_Cit%C3%A9_%28Ligne_4%29.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MP_14_CA_51_%C3%A0_Cit%C3%A9_(Ligne_4).jpg',
      author: 'S.G En Mobilité !',
      license: 'CC BY-SA 4.0',
    },
  },
  'mp14-ca-8': {
    id: 'mp14-ca-8', sprite: '/rolling-stock/mp14.png', name: 'MP 14 CA', mode: 'metro', cars: 8, levels: 1, doorsPerCar: 3, nose: 'sloped', livery: LIVERIES.idfmBlue,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e1/MP14_RATP_Ligne_14.jpg/500px-MP14_RATP_Ligne_14.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MP14_RATP_Ligne_14.jpg',
      author: 'Mohamed Sy',
      license: 'CC BY-SA 4.0',
    },
  },
  'mi09': {
    id: 'mi09', sprite: '/rolling-stock/mi09.png', defaultUnits: 2, name: 'MI 09', mode: 'rer', cars: 5, levels: 2, doorsPerCar: 3, nose: 'flat', livery: LIVERIES.stif,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/MI09_arrivant_en_gare_de_La_D%C3%A9fense_RER_A_%C3%A0_la_voie_2_%281%29.jpg/500px-MI09_arrivant_en_gare_de_La_D%C3%A9fense_RER_A_%C3%A0_la_voie_2_%281%29.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MI09_arrivant_en_gare_de_La_D%C3%A9fense_RER_A_%C3%A0_la_voie_2_(1).jpg',
      author: 'Remontees',
      license: 'CC BY-SA 4.0',
    },
  },
  'mi2n': {
    id: 'mi2n', defaultUnits: 2, name: 'MI 2N Altéo', mode: 'rer', cars: 5, levels: 2, doorsPerCar: 3, nose: 'flat', livery: LIVERIES.ratpRer,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/58/MI2N_%C3%A0_St_Maur.jpg/500px-MI2N_%C3%A0_St_Maur.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MI2N_%C3%A0_St_Maur.jpg',
      author: 'Réda TP',
      license: 'CC BY-SA 4.0',
    },
  },
  'mi79': {
    id: 'mi79', sprite: '/rolling-stock/mi79.png', defaultUnits: 2, name: 'MI 79', mode: 'rer', cars: 4, levels: 1, doorsPerCar: 4, nose: 'flat', livery: LIVERIES.mi79,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bb/Mi79_renov%C3%A9_bourg_la_reine.jpg/500px-Mi79_renov%C3%A9_bourg_la_reine.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Mi79_renov%C3%A9_bourg_la_reine.jpg',
      author: 'Niran91',
      license: 'CC BY-SA 4.0',
    },
  },
  'mi84': {
    id: 'mi84', defaultUnits: 2, name: 'MI 84', mode: 'rer', cars: 4, levels: 1, doorsPerCar: 4, nose: 'flat', livery: LIVERIES.stif,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/MI84_R%C3%A9nov%C3%A9.jpg/500px-MI84_R%C3%A9nov%C3%A9.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:MI84_R%C3%A9nov%C3%A9.jpg',
      author: 'Adnane',
      license: 'CC BY-SA 4.0',
    },
  },
  'z5600': {
    id: 'z5600', sprite: '/rolling-stock/z2n.png', name: 'Z 5600', mode: 'rer', cars: 6, levels: 2, doorsPerCar: 2, nose: 'flat', livery: LIVERIES.carmillon,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/Z5669_%2835T%29_%C3%A0_Vitry_par_Cramos.JPG/500px-Z5669_%2835T%29_%C3%A0_Vitry_par_Cramos.JPG',
      page: 'https://commons.wikimedia.org/wiki/File:Z5669_(35T)_%C3%A0_Vitry_par_Cramos.JPG',
      author: 'Cramos',
      license: 'CC BY-SA 4.0',
    },
  },
  'z8800': {
    id: 'z8800', sprite: '/rolling-stock/z2n.png', name: 'Z 8800', mode: 'rer', cars: 4, levels: 2, doorsPerCar: 2, nose: 'flat', livery: LIVERIES.carmillon,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Z_8800_in_Choisy-le-Roi%2C_2019.jpg/500px-Z_8800_in_Choisy-le-Roi%2C_2019.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Z_8800_in_Choisy-le-Roi,_2019.jpg',
      author: 'Mohamed SY',
      license: 'CC BY-SA 4.0',
    },
  },
  'z20500': {
    id: 'z20500', sprite: '/rolling-stock/z2n.png', name: 'Z 20500', mode: 'rer', cars: 4, levels: 2, doorsPerCar: 2, nose: 'flat', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3c/Z_20500_IDF_Mobilit%C3%A9s_Ligne_P.jpg/500px-Z_20500_IDF_Mobilit%C3%A9s_Ligne_P.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Z_20500_IDF_Mobilit%C3%A9s_Ligne_P.jpg',
      author: 'Mohamed SY',
      license: 'CC BY-SA 4.0',
    },
  },
  'z20900': {
    id: 'z20900', sprite: '/rolling-stock/z2n.png', name: 'Z 20900', mode: 'rer', cars: 4, levels: 2, doorsPerCar: 2, nose: 'sloped', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2d/Z_20900_du_RER_C_-_Transilien_SNCF.jpg/500px-Z_20900_du_RER_C_-_Transilien_SNCF.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Z_20900_du_RER_C_-_Transilien_SNCF.jpg',
      author: 'Mohamed SY',
      license: 'CC BY-SA 4.0',
    },
  },
  'z58000': {
    id: 'z58000', sprite: '/rolling-stock/rer-ng.png', name: 'RER NG (Z 58000)', mode: 'rer', cars: 6, levels: 2, doorsPerCar: 2, nose: 'rounded', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b3/RER_NG_porte_maillot.jpg/500px-RER_NG_porte_maillot.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:RER_NG_porte_maillot.jpg',
      author: 'Adnane302',
      license: 'CC0',
    },
  },
  'z58500': {
    id: 'z58500', sprite: '/rolling-stock/rer-ng.png', name: 'RER NG (Z 58500)', mode: 'rer', cars: 7, levels: 2, doorsPerCar: 2, nose: 'rounded', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/RER_NG_009M.jpg/500px-RER_NG_009M.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:RER_NG_009M.jpg',
      author: 'Adnane',
      license: 'CC BY-SA 4.0',
    },
  },
  'regio2n': {
    id: 'regio2n', sprite: '/rolling-stock/regio2n.png', name: 'Regio 2N (Z 57000)', mode: 'transilien', cars: 8, levels: 2, doorsPerCar: 1, nose: 'sloped', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/Z_57000%2C_Livr%C3%A9e_%C3%8Ele-de-France_Mobilit%C3%A9s_Regio2n.jpg/500px-Z_57000%2C_Livr%C3%A9e_%C3%8Ele-de-France_Mobilit%C3%A9s_Regio2n.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Z_57000,_Livr%C3%A9e_%C3%8Ele-de-France_Mobilit%C3%A9s_Regio2n.jpg',
      author: 'Adnane',
      license: 'CC BY-SA 4.0',
    },
  },
  'z50000-8': {
    id: 'z50000-8', sprite: '/rolling-stock/z50000.png', name: 'Francilien (Z 50000)', mode: 'transilien', cars: 8, levels: 1, doorsPerCar: 1, nose: 'rounded', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/NAT_Z50000_%2802H%2C_livr%C3%A9e_IDFM%29_%C3%A0_Champagne-sur-Oise.jpg/500px-NAT_Z50000_%2802H%2C_livr%C3%A9e_IDFM%29_%C3%A0_Champagne-sur-Oise.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:NAT_Z50000_(02H,_livr%C3%A9e_IDFM)_%C3%A0_Champagne-sur-Oise.jpg',
      author: 'Trainsandstations',
      license: 'CC BY-SA 4.0',
    },
  },
  'z50000-7': {
    id: 'z50000-7', sprite: '/rolling-stock/z50000.png', name: 'Francilien (Z 50000)', mode: 'transilien', cars: 7, levels: 1, doorsPerCar: 1, nose: 'rounded', livery: LIVERIES.idfmSncf,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Francilien_Z_50000_n%C2%B0266L_sur_la_ligne_J_du_Transilien_%C3%A0_destination_de_Paris_Saint_Lazare_en_gare_de_Pontoise.jpg/500px-Francilien_Z_50000_n%C2%B0266L_sur_la_ligne_J_du_Transilien_%C3%A0_destination_de_Paris_Saint_Lazare_en_gare_de_Pontoise.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Francilien_Z_50000_n%C2%B0266L_sur_la_ligne_J_du_Transilien_%C3%A0_destination_de_Paris_Saint_Lazare_en_gare_de_Pontoise.jpg',
      author: 'Ctemlen',
      license: 'CC BY 4.0',
    },
  },
  'b82500': {
    id: 'b82500', sprite: '/rolling-stock/agc.png', name: 'AGC (B 82500)', mode: 'transilien', cars: 4, levels: 1, doorsPerCar: 2, nose: 'sloped', livery: LIVERIES.transilien,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/TransilienP_B82500_Paris-Est.jpg/500px-TransilienP_B82500_Paris-Est.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:TransilienP_B82500_Paris-Est.jpg',
      author: 'Eole99',
      license: 'CC BY-SA 3.0',
    },
  },
  'citadis-305': {
    id: 'citadis-305', sprite: '/rolling-stock/citadis-305.png', name: 'Citadis 305 (TW20)', mode: 'tram', cars: 5, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.idfmTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/TW20_%C3%A0_jean_rostand.jpg/500px-TW20_%C3%A0_jean_rostand.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:TW20_%C3%A0_jean_rostand.jpg',
      author: 'Neolyos',
      license: 'CC BY 4.0',
    },
  },
  'citadis-302': {
    id: 'citadis-302', sprite: '/rolling-stock/citadis-402.png', name: 'Citadis 302', mode: 'tram', cars: 5, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.ratpTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Tramway_T2_Faubourg_de_l%27Arche_14-09-20.jpg/500px-Tramway_T2_Faubourg_de_l%27Arche_14-09-20.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Tramway_T2_Faubourg_de_l%27Arche_14-09-20.jpg',
      author: 'RATP 77 OFF',
      license: 'CC BY-SA 4.0',
    },
  },
  'citadis-402': {
    id: 'citadis-402', sprite: '/rolling-stock/citadis-402.png', name: 'Citadis 402', mode: 'tram', cars: 7, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.ratpTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/Le_Tramway_parisien%2C_septembre_2014.jpg/500px-Le_Tramway_parisien%2C_septembre_2014.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Le_Tramway_parisien,_septembre_2014.jpg',
      author: 'besopha',
      license: 'CC BY 2.0',
    },
  },
  'citadis-405': {
    id: 'citadis-405', sprite: '/rolling-stock/citadis-405.png', name: 'Citadis 405', mode: 'tram', cars: 7, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.idfmTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Citadis_405_n%C2%B0911_%C3%A0_Porte_de_Choisy_par_Cramos.JPG/500px-Citadis_405_n%C2%B0911_%C3%A0_Porte_de_Choisy_par_Cramos.JPG',
      page: 'https://commons.wikimedia.org/wiki/File:Citadis_405_n%C2%B0911_%C3%A0_Porte_de_Choisy_par_Cramos.JPG',
      author: 'Cramos',
      license: 'CC BY-SA 4.0',
    },
  },
  'translohr-ste3': {
    id: 'translohr-ste3', name: 'Translohr STE3', mode: 'tram', cars: 3, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.ratpTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/T5_Station_March%C3%A9_de_Saint-Denis_1.JPG/500px-T5_Station_March%C3%A9_de_Saint-Denis_1.JPG',
      page: 'https://commons.wikimedia.org/wiki/File:T5_Station_March%C3%A9_de_Saint-Denis_1.JPG',
      author: 'Eole99',
      license: 'CC BY-SA 3.0',
    },
  },
  'translohr-ste6': {
    id: 'translohr-ste6', name: 'Translohr STE6', mode: 'tram', cars: 6, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.ratpTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/57%2C900_T6_V%C3%A9lizy_Translohr_n%C2%B0621_par_Cramos.JPG/500px-57%2C900_T6_V%C3%A9lizy_Translohr_n%C2%B0621_par_Cramos.JPG',
      page: 'https://commons.wikimedia.org/wiki/File:57,900_T6_V%C3%A9lizy_Translohr_n%C2%B0621_par_Cramos.JPG',
      author: 'Cramos',
      license: 'CC BY-SA 3.0',
    },
  },
  'dualis-u53700': {
    id: 'dualis-u53700', sprite: '/rolling-stock/dualis.png', name: 'Citadis Dualis (U 53700)', mode: 'tram', cars: 4, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.idfmTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/Citadis_Dualis_Aulnay.jpg/500px-Citadis_Dualis_Aulnay.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Citadis_Dualis_Aulnay.jpg',
      author: 'Réda TP',
      license: 'CC BY-SA 4.0',
    },
  },
  'dualis-u53600': {
    id: 'dualis-u53600', sprite: '/rolling-stock/dualis.png', name: 'Citadis Dualis (U 53600)', mode: 'tram', cars: 4, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.dualisMagenta,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f1/U_53600_%C3%A0_quai_au_terminus_d%27Epinay-sur-Seine.jpg/500px-U_53600_%C3%A0_quai_au_terminus_d%27Epinay-sur-Seine.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:U_53600_%C3%A0_quai_au_terminus_d%27Epinay-sur-Seine.jpg',
      author: 'Remontees',
      license: 'CC BY-SA 4.0',
    },
  },
  'dualis-u52600': {
    id: 'dualis-u52600', sprite: '/rolling-stock/dualis.png', name: 'Citadis Dualis (U 52600)', mode: 'tram', cars: 4, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.idfmTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/T12_-_Evry-CC_-_2023-12-16_-_IMG_0179.jpg/500px-T12_-_Evry-CC_-_2023-12-16_-_IMG_0179.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:T12_-_Evry-CC_-_2023-12-16_-_IMG_0179.jpg',
      author: 'poudou99',
      license: 'CC BY-SA 4.0',
    },
  },
  'dualis-u53800': {
    id: 'dualis-u53800', sprite: '/rolling-stock/dualis.png', name: 'Citadis Dualis (U 53800)', mode: 'tram', cars: 4, levels: 1, doorsPerCar: 2, nose: 'tram', livery: LIVERIES.idfmTram,
    photo: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/64/Lisi%C3%A8re-Pereire_T13_Express_2022_01.jpg/500px-Lisi%C3%A8re-Pereire_T13_Express_2022_01.jpg',
      page: 'https://commons.wikimedia.org/wiki/File:Lisi%C3%A8re-Pereire_T13_Express_2022_01.jpg',
      author: 'Idris2000',
      license: 'CC BY-SA 4.0',
    },
  },
};

/** lineId → model ids, main model (largest fleet on the line per Wikipedia) first. */
export const LINE_STOCK: Record<string, string[]> = {
  // Métro
  C01371: ['mp05'], // 1
  C01372: ['mf01'], // 2
  C01373: ['mf67'], // 3
  C01386: ['mf67-3'], // 3bis
  C01374: ['mp89-ca', 'mp14-ca-6', 'mp05'], // 4
  C01375: ['mf01'], // 5
  C01376: ['mp89-cc'], // 6
  C01377: ['mf77'], // 7
  C01387: ['mf88'], // 7bis
  C01378: ['mf77'], // 8
  C01379: ['mf01'], // 9
  C01380: ['mf67', 'mf19'], // 10
  C01381: ['mp14-cc'], // 11
  C01382: ['mf67'], // 12
  C01383: ['mf77'], // 13
  C01384: ['mp14-ca-8'], // 14
  // RER
  C01742: ['mi09', 'mi2n'], // A
  C01743: ['mi79', 'mi84'], // B
  C01727: ['z20500', 'z20900', 'z8800', 'z5600'], // C
  C01728: ['z20500', 'regio2n', 'z58500'], // D
  C01729: ['z58000', 'z50000-8'], // E
  // Tramway
  C01389: ['citadis-305'], // T1
  C01390: ['citadis-302'], // T2
  C01391: ['citadis-402'], // T3a
  C01679: ['citadis-402'], // T3b
  C01843: ['dualis-u53700'], // T4
  C01684: ['translohr-ste3'], // T5
  C01794: ['translohr-ste6'], // T6
  C01774: ['citadis-302'], // T7
  C01795: ['citadis-302'], // T8
  C02317: ['citadis-405'], // T9
  C02528: ['citadis-405'], // T10
  C01999: ['dualis-u53600'], // T11
  C02529: ['dualis-u52600'], // T12
  C02344: ['dualis-u53800'], // T13
  C02732: ['dualis-u53600'], // T14
  // Transilien
  C01739: ['z50000-7'], // J
  C01740: ['z50000-7'], // L
  C01737: ['z50000-8'], // H
  C01738: ['z50000-8'], // K
  C01736: ['regio2n'], // N
  C01730: ['z50000-8', 'z20500', 'b82500'], // P
  C01731: ['regio2n'], // R
  C01741: ['z8800'], // U
  C02711: ['z20500', 'z20900', 'z8800', 'z5600'], // V
};

/** Models running on a line, main one first; [] for a line outside the catalogue. */
export function stockForLine(lineId: string): RollingStockModel[] {
  return (LINE_STOCK[lineId] ?? []).map((id) => MODELS[id]).filter((m): m is RollingStockModel => m !== undefined);
}

/** Model names joined by « / » (several models on a mixed line), null when there are none. */
export function stockLabel(models: RollingStockModel[]): string | null {
  if (models.length === 0) return null;
  return [...new Set(models.map((m) => m.name))].join(' / ');
}
