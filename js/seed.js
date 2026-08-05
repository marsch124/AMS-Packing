// seed.js — Martin's real packing lists, encoded in the app data structure.
// Translated from Swedish; the original wording is kept in `sv` where it is personal
// or not a 1:1 translation. Everything here is editable in the app.
//
// Each item carries: category (what), container (where), phase (when), plus flags
// itemType ('item' | 'reminder'), charging (needs charge / a cable), shortList
// (part of the minimal "short home list"), optional seasons/contexts/transports, and sub-items.
import { newItem, newList } from './model.js';

// Compact item builder. Short keys keep the data readable:
//   sv=Swedish original, cat=category, con=container, ph=phase, ctx=contexts,
//   seas=seasons, tr=transports, cater=catering, we=weather conditions,
//   charge, short, rem(inder), sub, note, qty, sec(tion id — per-template grouping)
function it(name, o = {}) {
  return newItem({
    name,
    swedish: o.sv || '',
    qty: o.qty || '',
    category: o.cat || 'Comfort & misc',
    container: o.con || 'Duffel bag',
    phase: o.ph || 'week',
    itemType: o.rem ? 'reminder' : 'item',
    charging: !!o.charge,
    chargeType: o.chargeType || '',
    shortList: !!o.short,
    seasons: o.seas || [],
    contexts: o.ctx || [],
    transports: o.tr || [],
    catering: o.cater || [],
    weather: o.we || [],
    sub: o.sub || [],
    note: o.note || '',
    liquid: !!o.liquid,
    restricted: !!o.restricted,
    section: o.sec || '',
  });
}
const CL = 'Clothing', ADV = 'Adventure clothing', FW = 'Footwear', SG = 'Sport gear',
  FD = 'Food & drink', TO = 'Toiletries', RX = 'Pharmacy / meds', EL = 'Electronics',
  DOC = 'Documents & money', CH = 'Charging', MI = 'Comfort & misc', REM = 'Reminders';

// ---------------------------------------------------------------- Run
const RUN = [
  it('Cap / beanie / headband', { sv: 'Keps/mössa / pannband', cat: CL, con: 'Duffel bag', short: true }),
  it('Running shorts', { sv: 'Run-byxor', cat: CL, note: '+ underwear if triathlon race' }),
  it('Running t-shirt', { sv: 'Run-t-shirt', cat: CL }),
  it('Running top', { sv: 'Run-tröja', cat: CL }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL }),
  it('Running shoes', { sv: 'Run-skor', cat: FW, short: true }),
  it('Socks', { sv: 'Strumpor', cat: CL, short: true }),
  it('Handkerchief / tissue', { sv: 'Näsduk', cat: MI }),
  it('Anti-chafe balm', { sv: '"Vaselin" mot skav', cat: TO }),
  it('Anti-blister tape', { sv: 'Tejp mot skav', cat: RX }),
  it('Run food / nutrition', { sv: 'Run-mat', cat: FD }),
  it('Headphones (AirPods / Wing)', { sv: 'Hörlurar', cat: EL, charge: true, short: true }),
  it('Phone', { sv: 'Mobil', cat: EL, charge: true, short: true }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro (incl. charger)', { sv: 'Garmin Epix Pro', cat: EL, charge: true, short: true }),
  it('Stryd pod + charger', { sv: 'Stryd samt laddare', cat: EL, charge: true }),
  // Outdoor extras (context Outdoor = the "All of the above" additions)
  it('Hydration system (vest / belt / handheld)', { sv: 'Vätskesystem (Väst / Bälte / I handen)', cat: SG, ctx: ['Outdoor'] }),
  it('Running belt', { sv: 'Löparbälte', cat: SG, ctx: ['Outdoor'] }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Beanie / cap', { sv: 'Mössa / Keps', cat: CL, ctx: ['Outdoor'] }),
  it('Gloves', { sv: 'Handskar', cat: CL, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Warm vest', { sv: 'Varm väst', cat: CL, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Windbreaker', { sv: 'Windbreaker', cat: CL, ctx: ['Outdoor'], we: ['wind', 'rain'] }),
  it('Reflectors', { sv: 'Reflex', cat: SG, ctx: ['Outdoor'], seas: ['Winter'] }),
  it('Plan route in Garmin', { sv: 'Planerad rutt i Garmin', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Check grey boxes in kitchen — anything to bring?', { sv: 'Kolla gråa lådor i köket', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charge Garmin Epix & Apple Watch (+ cables?)', { sv: 'Laddad Garmin Epix och Apple Watch (Laddkablage?)', cat: CH, charge: true, rem: true }),
  // Efter / after-recovery
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after' }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after' }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after' }),
  it('Change of clothes', { sv: 'Ombyte', cat: CL, ph: 'after' }),
];

// ---------------------------------------------------------------- Swim
const SWIM = [
  it('Swim trunks / swimsuit', { sv: 'Badbyxor / Baddräkt', cat: CL, con: 'Swim bag' }),
  it('Swim cap', { sv: 'Badmössa', cat: SG, con: 'Swim bag' }),
  it('Goggles', { sv: 'Goggles', cat: SG, con: 'Swim bag' }),
  it('Form goggles (with charged Workout)', { sv: 'Form-goggles med laddad Workout', cat: SG, con: 'Swim bag', charge: true }),
  it('Pull buoy', { sv: 'Dolme', cat: SG, con: 'Swim bag' }),
  it('Paddles', { sv: 'Paddlar', cat: SG, con: 'Swim bag' }),
  it('Fins', { sv: 'Fenor', cat: SG, con: 'Swim bag' }),
  it('Water bottle', { sv: 'Vattenflaska', cat: FD, con: 'Swim bag' }),
  it('Ear drops (swim/dive)', { sv: 'Ortinova', cat: RX, con: 'Swim bag' }),
  it('Case for regular glasses', { sv: 'Glasögonfodral till vanliga glasögon', cat: MI, con: 'Swim bag' }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, charge: true }),
  it('Padlock', { sv: 'Hänglås', cat: MI, con: 'Swim bag' }),
  it('Entry card', { sv: 'Inträdeskort', cat: DOC }),
  it('Earplugs', { sv: 'Öronproppar', cat: TO, con: 'Swim bag', note: 'optional' }),
  it('Nose clip', { sv: 'Näsklämma', cat: SG, con: 'Swim bag', note: 'optional' }),
  // Outdoor extras
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Anti-chafe cream', { sv: 'Skav-"kräm"', cat: TO, ctx: ['Outdoor'] }),
  it('Anti-blister tape (if long run right after)', { sv: 'Tejp mot skav om lång Run direkt efter', cat: RX, ctx: ['Outdoor'] }),
  it('Wetsuit', { sv: 'Våtdräkt', cat: SG, ctx: ['Outdoor'], sub: ['Calf pads (vad-kuddar)', 'Sleeves (ärmar)'] }),
  it('Tinted goggles', { sv: 'Tinted goggles?', cat: SG, ctx: ['Outdoor'] }),
  it('Hood + warm hood', { sv: 'Huva samt varm huva', cat: SG, ctx: ['Outdoor'] }),
  it('Tether cord', { sv: 'Håll-ihop-snöre', cat: SG, ctx: ['Outdoor'] }),
  it('Tow buoy', { sv: 'Boj', cat: SG, ctx: ['Outdoor'] }),
  it('Dry bag', { sv: 'Vattentät påse', cat: MI, ctx: ['Outdoor'] }),
  it('Towel / sarong / swim poncho', { sv: 'Handduk / Sarong / Badponcho', cat: TO, ctx: ['Outdoor'] }),
  it('Sliders / neoprene boots', { sv: 'Foppa-tofflor / Neoprene boots', cat: FW, ctx: ['Outdoor'] }),
  it('Warm change of clothes', { sv: 'Varmt ombyte', cat: CL, ctx: ['Outdoor'] }),
  it('Gel / nutrition', { sv: 'Gelé', cat: FD, ctx: ['Outdoor'] }),
  it('Plan route in Garmin', { sv: 'Planerad rutt i Garmin?', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Check grey boxes in kitchen — anything to bring?', { sv: 'Kolla gråa lådor i köket', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charge Garmin Epix, Form-goggles & Apple Watch', { sv: 'Laddad Garmin Epix, Form-goggles och Apple Watch', cat: CH, charge: true, rem: true }),
  // Efter-grejor
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after' }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after' }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after' }),
  it('Change + a little extra warm clothing', { sv: 'Ombyte samt lite extra varma kläder', cat: CL, ph: 'after' }),
  it('Recovery food', { sv: 'Mat för återhämtning', cat: FD, ph: 'after' }),
];

// ---------------------------------------------------------------- Bike
const BIKE = [
  it('Cycling shorts / bibs', { sv: 'Cykelbyxor', cat: CL }),
  it('Cycling t-shirt', { sv: 'Cykel-t-shirt', cat: CL }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL }),
  it('Cycling shoes', { sv: 'Cykel-skor', cat: FW, short: true }),
  it('Socks', { sv: 'Strumpor', cat: CL }),
  it('Headband', { sv: 'Pannband', cat: CL, short: true }),
  it('Fluid / drink', { sv: 'Vätska/dryck', cat: FD, short: true }),
  it('Boxers / underwear', { sv: 'Boxor', cat: CL, short: true }),
  it('Tissues / paper', { sv: 'Papper', cat: MI, short: true }),
  it('Phone', { sv: 'Mobiltelefon', cat: EL, charge: true, short: true }),
  it('Headphones (AirPods / Wing)', { sv: 'Hörlurar (AirPods/Wing)', cat: EL, charge: true, short: true }),
  it('Apple Watch', { sv: 'Klocka Apple Watch', cat: EL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, charge: true, short: true }),
  // Outdoor extras
  it('Bike', { sv: 'Cykel', cat: SG, con: 'Other', ctx: ['Outdoor'], tr: ['Car', 'RV'] }),
  it('Charged Di2 / gears', { sv: 'Laddad växel', cat: SG, charge: true, ctx: ['Outdoor'] }),
  it('Cycling jersey', { sv: 'Cykel-tröja', cat: CL, ctx: ['Outdoor'] }),
  it('Cycling jacket', { sv: 'Cykel-jacka', cat: CL, ctx: ['Outdoor'] }),
  it('Cap / beanie', { sv: 'Keps/mössa', cat: CL, ctx: ['Outdoor'] }),
  it('Gloves', { sv: 'Handskar', cat: CL, ctx: ['Outdoor'] }),
  it('Tissue', { sv: 'Näsduk', cat: MI, ctx: ['Outdoor'] }),
  it('Body Glide (anti-chafe)', { sv: 'Body glide', cat: TO, ctx: ['Outdoor'] }),
  it('Sports drink', { sv: 'Sportdryck', cat: FD, ctx: ['Outdoor'] }),
  it('Bars / gels', { sv: 'Barer/gelé', cat: FD, ctx: ['Outdoor'] }),
  it('Hydration (bottles / vest / jersey pockets)', { sv: 'Vätskesystem (Cykelflaskor / Väst / Flaskor i ryggfickor)', cat: SG, ctx: ['Outdoor'] }),
  it('Bike computer (charged)', { sv: 'Cykeldator (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Plan route in Elemnt', { sv: 'Planerad rutt i Elemnts', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Radar (charged)', { sv: 'Radar (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Light (charged)', { sv: 'Lampa (laddad)', cat: EL, charge: true, ctx: ['Outdoor'] }),
  it('Helmet', { sv: 'Hjälm', cat: SG, ctx: ['Outdoor'] }),
  it('Sunscreen', { sv: 'Solkräm', cat: TO, ctx: ['Outdoor'], seas: ['Summer'] }),
  it('Cycling glasses', { sv: 'Cykelglasögon', cat: SG, ctx: ['Outdoor'] }),
  it('Pump', { sv: 'Pump', cat: SG, ctx: ['Outdoor'] }),
  it('Bike stand', { sv: 'Bike stand', cat: SG, ctx: ['Outdoor'] }),
  it('Lock', { sv: 'Lås', cat: SG, ctx: ['Outdoor'] }),
  it('Repair kit', { sv: 'Lagningsgrejor', cat: SG, ctx: ['Outdoor'], sub: ['Tools (Verktyg)', 'Patch kit (Lagningssats)', 'Spare tube (Extra tub)', 'CO2 cartridge (Kolsyrepatron)'] }),
  it('Check grey boxes — anything to bring?', { sv: 'Kolla gråa lådor om något ska med', cat: REM, rem: true, ctx: ['Outdoor'] }),
  it('Charging cables: bike computer? gears? Garmin Epix? light? bike alarm?', { sv: 'Laddkablar: Cykeldator? Växel? Garmin Epix? Lampa? Cykellarm?', cat: CH, charge: true, rem: true }),
  // Efter / After — a recovery reminder checklist (Martin: these are reminders).
  it('Towel', { sv: 'Handduk', cat: TO, ph: 'after', rem: true }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, ph: 'after', rem: true }),
  it('Biotherm moisturiser', { sv: 'Biotherm', cat: TO, ph: 'after', rem: true }),
  it('Change of clothes', { sv: 'Ombyte', cat: CL, ph: 'after', rem: true }),
];

// ---------------------------------------------------------------- Golf
const GOLF = [
  // Komihåg-kläder (remember clothes)
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: CL }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: CL }),
  it('Fleece top', { sv: 'Fleecetröja', cat: CL }),
  it('Fleece trousers ("Smurf")', { sv: 'Fleecebyxa (Smurf)', cat: CL }),
  it('Cap / sun hat', { sv: 'Keps/Solhatt', cat: CL }),
  it('Beanie and mittens', { sv: 'Mössa och vantar', cat: CL, seas: ['Winter'] }),
  it('Jacket', { sv: 'Jacka', cat: CL }),
  it('Rain suit', { sv: 'Regnställ', cat: CL, we: ['rain'] }),
  it('Extra socks', { sv: 'Extra strumpor', cat: CL }),
  // Komihåg-saker (remember things)
  it('Golf gear bag', { sv: 'Golf-grejor-väska', cat: SG, con: 'Golf bag' }),
  it('Tissues', { sv: 'Snorpapper', cat: MI }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI }),
  it('Charged and fixed', { sv: 'Laddat och lagat', cat: CH, rem: true, charge: true }),
  it('Drone', { sv: 'Drönare', cat: EL, charge: true }),
  // Mat Fika Dryck
  it('Nalgene bottle with water', { sv: 'Nalgene-flaska med vatten', cat: FD }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD }),
  it('Snacks ("Hobbit food")', { sv: 'Hobbitmat', cat: FD }),
  // Golfkläder
  it('Shirt', { sv: 'Skjorta', cat: CL }),
  it('Sweater', { sv: 'Tröja', cat: CL }),
  it('Golf trousers', { sv: 'Golfbyxor', cat: CL }),
  it('Shorts', { sv: 'Shorts', cat: CL, seas: ['Summer'] }),
  it('Belt', { sv: 'Skärp', cat: CL }),
  it('Golf / running socks', { sv: 'Golfstrumpor/Löparstrumpor', cat: CL }),
  it('Golf shoes', { sv: 'Golfskor', cat: FW }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, seas: ['Summer'] }),
  it('Body lotion', { sv: 'Kroppslotion', cat: TO }),
  // Sällan-grejor (seldom things)
  it('Shoe polish', { sv: 'Skoputs', cat: MI }),
  it('Travel bag', { sv: 'Resebag', cat: MI, con: 'Duffel bag' }),
  it('Club protector for flights', { sv: 'Topp-boy', cat: SG, con: 'Golf bag', tr: ['Plane'] }),
  // I golfbagen (in the golf bag) — container Golf bag
  it('Golf cap', { sv: 'Golfkeps', cat: CL, con: 'Golf bag' }),
  it('Bag', { sv: 'Bag', cat: SG, con: 'Golf bag' }),
  it('Clubs', { sv: 'Klubbor', cat: SG, con: 'Golf bag' }),
  it('Balls', { sv: 'Bollar', cat: SG, con: 'Golf bag' }),
  it('Tees', { sv: 'Peggar', cat: SG, con: 'Golf bag' }),
  it('Divot tool', { sv: 'Greenlagare', cat: SG, con: 'Golf bag' }),
  it('Ball marker', { sv: 'Greenmarkör', cat: SG, con: 'Golf bag' }),
  it('Club towel', { sv: 'Klubbhandduk', cat: SG, con: 'Golf bag' }),
  it('Club cleaner', { sv: 'Klubbrengörare', cat: SG, con: 'Golf bag' }),
  it('Golf pen', { sv: 'Golfpenna', cat: SG, con: 'Golf bag' }),
  it('Umbrella holder', { sv: 'Paraplyhållare', cat: SG, con: 'Golf bag' }),
  it('Umbrella', { sv: 'Paraply', cat: SG, con: 'Golf bag' }),
  it('Sleeves', { sv: 'Sleeves / Ärmar', cat: CL, con: 'Golf bag' }),
  it('Golf beanie', { sv: 'Golfmössa', cat: CL, con: 'Golf bag' }),
  it('Glove', { sv: 'Handske', cat: SG, con: 'Golf bag' }),
  it('Golf gloves, 5-finger', { sv: 'Golfhandskar, 5-fingers', cat: SG, con: 'Golf bag' }),
  it('Golf mittens', { sv: 'Golfvantar, tum', cat: SG, con: 'Golf bag', seas: ['Winter'] }),
  it('Powerbank', { sv: 'Powerbank', cat: EL, con: 'Golf bag', charge: true }),
  // Morgonlistan (morning list)
  it('iPhone Power Pack', { sv: 'iPhone Power Pack', cat: EL, ph: 'morning', charge: true }),
  it('Sunglasses', { sv: 'Shades', cat: CL, ph: 'morning' }),
  it('Golf shoes', { sv: 'Golfskor', ph: 'morning', cat: FW }),
  it('Water', { sv: 'Vatten', cat: FD, ph: 'morning' }),
  it('Snack (fika)', { sv: 'Fika', cat: FD, ph: 'morning' }),
  it('Possible rain gear', { sv: 'Eventuella regnkläder', cat: CL, ph: 'morning', we: ['rain'] }),
  it('Possible clothes, beanie, gloves, umbrella', { sv: 'Eventuella kläder, mössa, handskar, paraply', cat: CL, ph: 'morning', we: ['rain', 'cold'] }),
  it('Sun hats', { sv: 'Solhattar', cat: CL, ph: 'morning', seas: ['Summer'] }),
  it('Tissues', { sv: 'Näsdukar', cat: MI, ph: 'morning' }),
  it('Wallet', { sv: 'Plånbok', cat: DOC, ph: 'morning' }),
  it('Marker pen', { sv: 'Märkpenna', cat: MI, ph: 'morning' }),
  it('Phone', { sv: 'Mobil', cat: EL, ph: 'morning', charge: true }),
  it('Laser rangefinder', { sv: 'Laserpekare', cat: EL, ph: 'morning' }),
  // Vid ytterdörren (at the front door)
  it('Sunscreen — face', { sv: 'Solskydda ansikte', cat: TO, ph: 'door', seas: ['Summer'] }),
  it('Drink water', { sv: 'Drick vatten', cat: REM, rem: true, ph: 'door' }),
  it('Use the toilet', { sv: 'Gå på toaletten', cat: REM, rem: true, ph: 'door' }),
  it('Jacket, beanie and mittens?', { sv: 'Jacka, mössa och vantar?', cat: CL, ph: 'door' }),
  it('Sun hat (MS)', { sv: 'Solhatt (MS)', cat: CL, ph: 'door', seas: ['Summer'] }),
  it('Sweater', { sv: 'Tröja', cat: CL, ph: 'door' }),
  it('Compression socks', { sv: 'Stödstrumpor', cat: CL, ph: 'door' }),
  it('Keys, phone, wallet', { sv: 'Nycklar, mobbe, plånbok', cat: DOC, ph: 'door' }),
];

// ---------------------------------------------------------------- Hiking
const HIKE = [
  // Kläder
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: CL, con: 'Hiking backpack' }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: CL, con: 'Hiking backpack' }),
  it('Fleece top', { sv: 'Fleecetröja', cat: CL, con: 'Hiking backpack' }),
  it('Fleece trousers ("Smurf")', { sv: 'Fleecebyxa (Smurf)', cat: CL, con: 'Hiking backpack' }),
  it('Cap / sun hat', { sv: 'Keps/Solhatt', cat: CL, con: 'Hiking backpack' }),
  it('Beanie and mittens', { sv: 'Mössa och vantar', cat: CL, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Rain suit', { sv: 'Regnställ', cat: ADV, con: 'Hiking backpack', we: ['rain'] }),
  it('Extra socks', { sv: 'Extra strumpor', cat: CL, con: 'Hiking backpack' }),
  it('Adventure trousers', { sv: 'Äventyrsbyxor', cat: ADV, con: 'Hiking backpack' }),
  it('Adventure belt', { sv: 'Äventyrsbälte', cat: ADV, con: 'Hiking backpack' }),
  it('Hiking socks', { sv: 'Vandringsstrumpor', cat: CL, con: 'Hiking backpack' }),
  it('Shell garment', { sv: 'Skalplagg', cat: ADV, con: 'Hiking backpack' }),
  it('Poncho', { sv: 'Poncho', cat: ADV, con: 'Hiking backpack' }),
  it('Neck gaiter', { sv: 'Neck gaiter', cat: CL, con: 'Hiking backpack' }),
  it('Extra change of clothes', { sv: 'Extra klädombyte', cat: CL, con: 'Hiking backpack' }),
  // Prylar Övrigt (gadgets / other)
  it('Hiking map', { sv: 'Vandringskarta', cat: SG, con: 'Hiking backpack' }),
  it('Guidebook (climbing / hiking)', { sv: 'Förare', cat: SG, con: 'Hiking backpack' }),
  it('First-aid kit', { sv: '1:a hjälpen kit', cat: RX, con: 'Hiking backpack' }),
  it('Tissues', { sv: 'Snorpapper', cat: MI, con: 'Hiking backpack' }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI, con: 'Hiking backpack' }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, con: 'Hiking backpack' }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI, con: 'Hiking backpack' }),
  it('Charged and fixed', { sv: 'Laddat och lagat', cat: CH, rem: true, charge: true }),
  it('Rain/sweat cover for phone', { sv: 'Regn/svett-skydd till mobilen', cat: SG, con: 'Hiking backpack', we: ['rain'] }),
  it('Drone', { sv: 'Drönare', cat: EL, charge: true }),
  it('Camera', { sv: 'Kamera', cat: EL, charge: true }),
  it('Approach shoes / boots', { sv: 'Approach-skor/Kängor', cat: FW }),
  it('Knee bandage', { sv: 'Kniebandage', cat: RX, con: 'Hiking backpack' }),
  it('Sit pad', { sv: 'Sittunderlag', cat: SG, con: 'Hiking backpack' }),
  it('Trekking poles', { sv: 'Sticks', cat: SG, con: 'Hiking backpack' }),
  // Mat Fika Dryck
  it('Nalgene bottle with water', { sv: 'Nalgene-flaska med vatten', cat: FD }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD }),
  it('Snacks ("Hobbit food")', { sv: 'Hobbitmat', cat: FD }),
  it('Snack fruit', { sv: 'Fika Frukt', cat: FD }),
  it('Bar', { sv: 'Bar', cat: FD }),
  it('Extra water for the trip home', { sv: 'Extra vatten till hemfärden', cat: FD, ph: 'after' }),
  it('Thermos with hot drink', { sv: 'Termos med varm dryck', cat: FD, seas: ['Winter'] }),
  // Diverse
  it('Climbing spikes / crampons', { sv: 'Vandersteghjärn', cat: SG, seas: ['Winter'] }),
  it('Avalanche gear', { sv: 'Lavinutrustning', cat: SG, seas: ['Winter'] }),
  it('Heat pads', { sv: 'Värmedpads', cat: MI, seas: ['Winter'] }),
  // Aid (climbing protection) — context Outdoor
  it('Rope ladders / etriers', { sv: 'Repstegar', cat: SG, ctx: ['Outdoor'] }),
  it('Pitons and hammer', { sv: 'Pitonger och hammare', cat: SG, ctx: ['Outdoor'] }),
  it('Sky-hooks', { sv: 'Sky-hooks', cat: SG, ctx: ['Outdoor'] }),
  it('Boots', { sv: 'Kängor', cat: FW, ctx: ['Outdoor'] }),
  // Rygga (in the backpack)
  it('Mountain pen', { sv: 'Bergsports-penna', cat: MI, con: 'Hiking backpack' }),
  it('Nalgene bottle (large)', { sv: 'Nalgene-flaska (stor)', cat: FD, con: 'Hiking backpack' }),
  it('Platypus (hydration)', { sv: 'Pladipus', cat: SG, con: 'Hiking backpack' }),
  it('Extra outer layer', { sv: 'Extra ytterlager', cat: ADV, con: 'Hiking backpack' }),
  it('Down jacket', { sv: 'Dunjacka', cat: ADV, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Alpine mittens', { sv: 'Handskar tum - alpint', cat: CL, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Spare change of clothes', { sv: 'Reservombyte', cat: CL, con: 'Hiking backpack' }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, con: 'Hiking backpack', charge: true }),
  it('Blister tape', { sv: 'Tejp m. skavsår', cat: RX, con: 'Hiking backpack' }),
  it('Emergency blanket', { sv: 'Rescue-folie', cat: SG, con: 'Hiking backpack' }),
  it('Rain cover (for backpack)', { sv: 'Raincover (t ryggsäck)', cat: SG, con: 'Hiking backpack', we: ['rain'] }),
  it('Ski goggles', { sv: 'Skidglasögon', cat: SG, con: 'Hiking backpack', seas: ['Winter'] }),
  it('Rope, 20 m – 9 mm', { sv: 'Rep, 20m - 9 mm', cat: SG, con: 'Hiking backpack', ctx: ['Outdoor'] }),
  it('Bars', { sv: 'Barer', cat: FD, con: 'Hiking backpack' }),
  it('First-aid kit', { sv: '1:a hjälpen-kit', cat: RX, con: 'Hiking backpack' }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, con: 'Hiking backpack', seas: ['Summer'] }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO, con: 'Hiking backpack' }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX, con: 'Hiking backpack' }),
  it('Blister tape', { sv: 'Tejp mot skavsår', cat: RX, con: 'Hiking backpack' }),
  it('Toilet paper', { sv: 'Toapapper', cat: TO, con: 'Hiking backpack' }),
  // Hütte (at the hut)
  it('Download a film', { sv: 'Ladda ner någon film', cat: REM, rem: true, note: 'at the hut' }),
  it('DAV card', { sv: 'DAV-kort', cat: DOC, note: 'at the hut' }),
  it('Reading', { sv: 'Läsning', cat: MI, note: 'at the hut' }),
  it('Lounge pants', { sv: 'Schlabberhosen', cat: CL, note: 'at the hut' }),
  it('Indoor slippers', { sv: 'Innetofflor', cat: FW, note: 'at the hut' }),
  it('Silk sleeping-bag liner', { sv: '"Sidensovsäck"', cat: MI, note: 'at the hut' }),
  it('Silk sheet', { sv: '"Sidenlakan"', cat: MI, note: 'at the hut' }),
  it('Wash bag', { sv: 'Nescessär', cat: TO, con: 'Toiletry bag', note: 'at the hut' }),
  it('Towels, shower', { sv: 'Handdukar, dusch', cat: TO, note: 'at the hut' }),
  it('iPad', { sv: 'iPad', cat: EL, charge: true, note: 'at the hut' }),
  // I handen (in hand)
  it('Gaiters (simple)', { sv: 'Gaiters (simple)', cat: SG, ph: 'door' }),
  it('SKF membership card', { sv: 'Medlemskort SKF', cat: DOC, ph: 'door' }),
  it('Hand-sanitizer wipes', { sv: 'Handsprit-servetter', cat: TO, ph: 'door' }),
  // Morgonlistan
  it('Extra socks', { sv: 'Extra strumpor', cat: CL, ph: 'morning' }),
  it('Change shirt / t-shirt', { sv: 'Skjorta/t-shirt i ombyte', cat: CL, ph: 'morning' }),
  it('Umbrella (sun and rain)', { sv: 'Paraply (mot sol och regn)', cat: SG, ph: 'morning', we: ['rain', 'hot'] }),
];

// ---------------------------------------------------------------- Travel (Travel-Main base)
const CO = 'Carry-on / hand luggage', CK = 'Checked luggage', TOI = 'Toiletry bag', EB = 'Electronics bag';
const TRAVEL = [
  // Stadskläder (city clothes)
  it('Underwear', { sv: 'Kalsonger / Trosor', cat: CL, con: CK }),
  it('Socks', { sv: 'Strumpor', cat: CL, con: CK }),
  it('Bra', { sv: 'BH', cat: CL, con: CK }),
  it('Sports bra', { sv: 'Sport-BH', cat: CL, con: CK }),
  it('Vests & t-shirts', { sv: 'Linnen och t-shirtar', cat: CL, con: CK }),
  it('Shirts', { sv: 'Skjortor', cat: CL, con: CK }),
  it('Polo shirts', { sv: 'Pikét-skjortor', cat: CL, con: CK }),
  it('Sweaters', { sv: 'Tröjor', cat: CL, con: CK }),
  it('Long trousers', { sv: 'Långbyxor', cat: CL, con: CK }),
  it('Belt', { sv: 'Bälte', cat: CL, con: CK }),
  it('Three-quarter trousers', { sv: 'Trekvartsbyxor', cat: CL, con: CK }),
  it('Shorts', { sv: 'Shorts', cat: CL, con: CK, seas: ['Summer'] }),
  it('Skirt', { sv: 'Kjol', cat: CL, con: CK }),
  it('Dress', { sv: 'Klänning', cat: CL, con: CK }),
  it('Shoes', { sv: 'Skor', cat: FW, con: CK }),
  it('Sneakers', { sv: 'Gympadojor', cat: FW, con: CK }),
  it('Sandals', { sv: 'Sandaler', cat: FW, con: CK, seas: ['Summer'] }),
  it('Cap', { sv: 'Keps', cat: CL, con: CK }),
  it('Sun hat', { sv: 'Solhatt', cat: CL, con: CK, seas: ['Summer'] }),
  it('Beanie', { sv: 'Mössa', cat: CL, con: CK, seas: ['Winter'] }),
  it('Gloves (finger)', { sv: 'Handskar, finger', cat: CL, con: CK, seas: ['Winter'] }),
  it('Gloves (mitten)', { sv: 'Handskar, tum', cat: CL, con: CK, seas: ['Winter'] }),
  it('Jacket', { sv: 'Jacka', cat: CL, con: CK }),
  it('Windbreaker jacket', { sv: 'Windbreaker-jacka', cat: CL, con: CK }),
  // Äventyrskläd (adventure clothing)
  it('Adventure shirts', { sv: 'Äventyrsskjortor', cat: ADV, con: CK }),
  it('Merino wool layer 1', { sv: 'Merino Wool Lager 1', cat: ADV, con: CK }),
  it('WoolPower layer 2', { sv: 'WoolPower Lager 2', cat: ADV, con: CK }),
  it('Fleece top', { sv: 'Fleece-tröja', cat: ADV, con: CK }),
  it('Adventure trousers', { sv: 'Äventyrsbyxor', cat: ADV, con: CK }),
  it('Adventure belt', { sv: 'Äventyrsbälte', cat: ADV, con: CK }),
  it('Down jacket', { sv: 'Dunjacka', cat: ADV, con: CK, seas: ['Winter'] }),
  it('Shell garment', { sv: 'Skalplagg', cat: ADV, con: CK }),
  it('Rain suit', { sv: 'Regnställ', cat: ADV, con: CK }),
  it('Poncho', { sv: 'Poncho', cat: ADV, con: CK }),
  it('Approach shoes', { sv: 'Approach-skor', cat: FW, con: CK }),
  it('Shoehorn', { sv: 'Schuhlöffel', cat: MI, con: CK }),
  it('Sleeves', { sv: 'Sleeves / Ärmar', cat: ADV, con: CK }),
  it('Flop mittens', { sv: 'Floppvantar', cat: CL, con: CK }),
  it('Neck gaiter', { sv: 'Neck gaiter', cat: CL, con: CK }),
  it('Knee bandage', { sv: 'Kniebandage', cat: RX, con: CK }),
  // Annat (other)
  it('Insurance card', { sv: 'Försäkringskort', cat: DOC, con: CO }),
  it('Marker pen (white + black)', { sv: 'Märkpenna (vit + svart)', cat: MI, con: CK }),
  it('Snack bag', { sv: 'Jause-säck', cat: FD, con: CK }),
  it('Towel(s)', { sv: 'Handduk(ar)', cat: TO, con: CK }),
  it('Leatherman', { sv: 'Leathermannen', cat: MI, con: CK }),
  it('Ace Pro camera', { sv: 'Ace Pro-kamera', cat: EL, con: CK, charge: true }),
  it('Insta360 X4', { sv: 'Insta360 X4', cat: EL, con: CK, charge: true }),
  it('DJI Action Pocket', { sv: 'DJI Action Pocket', cat: EL, con: CK, charge: true }),
  it('DJI OSMO Pocket', { sv: 'DJI OSMO Pocket', cat: EL, con: CK, charge: true }),
  it('Drone DJI Pro Mini 4', { sv: 'Drönare DJI Pro Mini 4', cat: EL, con: CK, charge: true }),
  it('DJI Neo drone', { sv: 'DJI Neo drönare', cat: EL, con: CK, charge: true }),
  it('Massage gun', { sv: 'Massagepistol', cat: EL, con: CK, charge: true }),
  it('eReader', { sv: 'eReader', cat: EL, con: CO, charge: true }),
  it('Whoop charger', { sv: 'Whoop-laddare', cat: CH, con: CK, charge: true }),
  it('Garmin + charger', { sv: 'Garmin + ladd', cat: EL, con: CK, charge: true }),
  it('Active earplugs', { sv: 'Aktiva öronproppar', cat: EL, con: CO, charge: true }),
  it('Contacts + reading glasses', { sv: 'MS Linser + lins-läsglasögon', cat: TO, con: CO }),
  it('Sit pad', { sv: 'Sittunderlag', cat: SG, con: CK }),
  it('First-aid kit', { sv: '1:a hjälpen-kit', cat: RX, con: CK }),
  it('Neti pot incl. salt', { sv: 'Netipot inkl Salt', cat: TO, con: TOI }),
  it('Umbrella', { sv: 'Paraply', cat: MI, con: CK }),
  it('Beanie / Cioccolina', { sv: 'Beanie / Cioccolina', cat: CL, con: CK }),
  it('Beach blanket', { sv: 'Beach-blanket', cat: MI, con: CK }),
  it('Laundry bag + bra bag', { sv: 'Smutsklädpåse + BH-påse', cat: MI, con: CK }),
  it('Magic pearls', { sv: 'Magic perls', cat: TO, con: CK }),
  it('Swimwear', { sv: 'Badkläder', cat: CL, con: CK }),
  it('Sarongs', { sv: 'Saronger', cat: CL, con: CK, seas: ['Summer'] }),
  it('Loungewear', { sv: 'Mysbyxor', cat: CL, con: CK }),
  it('Bathrobe / watery poncho', { sv: 'Morgonrock / Watery-poncho', cat: CL, con: CK }),
  it('Hair dryer', { sv: 'Hårtork', cat: EL, con: CK }),
  it('Hair straightener', { sv: 'Plattång', cat: EL, con: CK }),
  it('Day pack', { sv: 'Dag-ryggsäck', cat: SG, con: 'Day pack' }),
  it('Shopping bags', { sv: 'Inköpskassar', cat: MI, con: CK }),
  it('Tech pouch', { sv: 'Tech-pouch', cat: EL, con: 'Tech pouch' }),
  // Elnik (electronics)
  it('220V adapters', { sv: '220v-adaptrar', cat: EL, con: EB }),
  it('Power strip', { sv: 'Fördelardosa', cat: EL, con: EB }),
  it('The 6-way (multi-plug)', { sv: '6:an', cat: EL, con: EB }),
  it('UltraHuman charger', { sv: 'Laddare UltraHuman', cat: CH, con: EB, charge: true }),
  it('Camera accessories', { sv: 'Kameratillbehör', cat: EL, con: EB }),
  it('Headlamp', { sv: 'Pannlampa', cat: EL, con: EB, charge: true }),
  // Träning (allm) — general training base (overlaps Run; dedup handles it)
  it('Running shoes', { sv: 'Löparskor', cat: FW, con: CK }),
  it('Running socks', { sv: 'Löparstrumpor', cat: CL, con: CK }),
  it('Running shorts', { sv: 'Löparbyxor', cat: CL, con: CK }),
  it('Running t-shirt', { sv: 'Löpar-t-shirt', cat: CL, con: CK }),
  it('Running cap', { sv: 'Löparkeps', cat: CL, con: CK, seas: ['Summer'] }),
  it('Running beanie & gloves', { sv: 'Löpmössa och löphandskar', cat: CL, con: CK, seas: ['Winter'] }),
  it('Windbreaker', { sv: 'Windbreaker', cat: CL, con: CK }),
  it('Running vest', { sv: 'Löparväst', cat: SG, con: CK }),
  it('Reflectors', { sv: 'Reflex', cat: SG, con: CK, seas: ['Winter'] }),
  it('Garmin Epix (charged)', { sv: 'Garmin-Epix (laddad)', cat: EL, con: CO, charge: true }),
  it('Stryd pod (charged)', { sv: 'Stryd-pod (laddad)', cat: EL, con: CO, charge: true }),
  it('Hair tie / headband', { sv: 'Hårsnodd / pannband', cat: CL, con: CK }),
  it('Training bottle', { sv: 'Träningsflaska', cat: FD, con: CK }),
  it('Training cord', { sv: 'Träningssnöre', cat: SG, con: CK }),
  // Necessär (toiletry bag)
  it('Body lotion', { sv: 'Kroppslotion', cat: TO, con: TOI }),
  it('Deodorant', { sv: 'Deo', cat: TO, con: TOI }),
  it('Headache tablets', { sv: 'Huvudvärkstabletter', cat: RX, con: TOI }),
  it('Face products', { sv: 'Ansiktsprodukter', cat: TO, con: TOI }),
  it('Tooth pickers', { sv: 'Tooth pickers', cat: TO, con: TOI }),
  it('Toothbrush', { sv: 'Tandborste', cat: TO, con: TOI }),
  it('Toothpaste', { sv: 'Tandkräm', cat: TO, con: TOI }),
  it('Dental floss', { sv: 'Flour', cat: TO, con: TOI }),
  it('Razor + foam', { sv: 'Rakhyvel + lödder', cat: TO, con: TOI }),
  it('Extra contacts + solution', { sv: 'AS extra linser + linsvätska', cat: TO, con: TOI }),
  it('Contraceptive pill', { sv: 'P-piller', cat: RX, con: TOI }),
  it('Panty liners', { sv: 'Trosskydd', cat: TO, con: TOI }),
  it('Hairbrush', { sv: 'Hårborste', cat: TO, con: TOI }),
  it('Hair ties', { sv: 'Hårsnoddar', cat: TO, con: TOI }),
  it('Cold-sore cream', { sv: 'Munsårskräm', cat: RX, con: TOI }),
  it('Nail clipper', { sv: 'Nageltång', cat: TO, con: TOI }),
  it('Small scissors', { sv: 'Liten sax', cat: TO, con: TOI }),
  it('Tweezers', { sv: 'Pincett', cat: TO, con: TOI }),
  it('Earplugs', { sv: 'Öronproppar', cat: TO, con: TOI }),
  it('Glasses cleaner', { sv: 'Brillenputz', cat: TO, con: TOI }),
  // Apotek (pharmacy)
  it('Allergy medicine', { sv: 'Allergimedicin', cat: RX, con: TOI }),
  it('Plasters', { sv: 'Plåster', cat: RX, con: TOI }),
  it('Sun protection', { sv: 'Solskydd', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Aftersun', { sv: 'Aftersun', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Hand sanitizer', { sv: 'Handsprit', cat: TO, con: TOI }),
  it('Shower gel', { sv: 'Duschkräm', cat: TO, con: TOI }),
  it('Shampoo', { sv: 'Schampo', cat: TO, con: TOI }),
  it('Conditioner', { sv: 'Balsam', cat: TO, con: TOI }),
  it('Vitamins etc.', { sv: 'Vitaminer m.m.', cat: RX, con: TOI }),
  it('Iron tablets', { sv: 'Järntabletter', cat: RX, con: TOI }),
  it('Resorb (rehydration)', { sv: 'Resorb', cat: RX, con: TOI }),
  it('Bars', { sv: 'Barer', cat: FD, con: CK }),
  it('Body massage oil', { sv: 'Kolja', cat: RX, con: TOI }),
  it('Mosquito spray', { sv: 'Myggspray', cat: TO, con: TOI, seas: ['Summer'] }),
  it('Cortisone cream', { sv: 'Kortisonsalva', cat: RX, con: TOI }),
  it('Foot file', { sv: 'Fotfil', cat: TO, con: TOI }),
  it('Blister plasters', { sv: 'Skavsårsplåster', cat: RX, con: TOI }),
  it('Finger tape', { sv: 'Fingertejp', cat: RX, con: TOI }),
  it('WaxOff (ear wax)', { sv: 'WaxOff', cat: RX, con: TOI }),
  it('Stomach medicine', { sv: 'Magmedicin', cat: RX, con: TOI }),
  it('Seasickness pills', { sv: 'Sjösjukepiller', cat: RX, con: TOI }),
  it('Sleeping pills', { sv: 'Sömnpiller', cat: RX, con: TOI }),
  it('Other medicines', { sv: 'Andra mediciner', cat: RX, con: TOI }),
  it('Toilet paper', { sv: 'Toapapper', cat: TO, con: CK }),
  it('Kitchen towel', { sv: 'Hushållspapper', cat: MI, con: CK }),
  it('Blood-pressure monitor', { sv: 'Blodtrycksmätare', cat: EL, con: CK }),
  it('Thermometer', { sv: 'Temp-mätare', cat: RX, con: TOI }),
  it('Oximeter', { sv: 'Oxymeter', cat: RX, con: TOI }),
  it('Tissues', { sv: 'Pappersnäsdukar', cat: MI, con: CO }),
  it('Lip balm', { sv: 'Lipsyl', cat: TO, con: CO }),
  it('Hand-sanitizer wipes', { sv: 'Handsprit-servetter', cat: TO, con: CO }),
  it('Pillows', { sv: 'Kuddar', cat: MI, con: CK }),
  it('Neck pillow', { sv: 'Nackkudde', cat: MI, con: CO }),
  it('Baggage keys', { sv: 'Nycklar till baggage', cat: DOC, con: CO }),
  it('Luggage scale', { sv: 'Resevåg', cat: MI, con: CK }),
  it('Crochet project', { sv: 'Virkningsprojekt', cat: MI, con: CO }),
  // Jobb (work)
  it('Work laptop', { sv: 'Jobbdator', cat: EL, con: CO, charge: true, note: 'work' }),
  it('Mouse', { sv: 'Mus', cat: EL, con: CO, note: 'work' }),
  it('RSA token', { sv: 'RSA-dosa', cat: DOC, con: CO, note: 'work' }),
  it('Saab ID', { sv: 'Saab-leg', cat: DOC, con: CO, note: 'work' }),
  it('Headphones / Puck', { sv: 'Hörlurar / Puck', cat: EL, con: CO, charge: true, note: 'work' }),
  it('Charger', { sv: 'Laddare', cat: CH, con: CO, charge: true, note: 'work' }),
  // Handbagage (carry-on)
  it('Passport', { sv: 'Pass', cat: DOC, con: CO }),
  it('Driving licence', { sv: 'Körkort', cat: DOC, con: CO }),
  it('Currency', { sv: 'Valuta', cat: DOC, con: CO }),
  it('Tickets', { sv: '"Biljetter"', cat: DOC, con: CO }),
  it('Ballograf pen', { sv: 'Ballograf-penna', cat: MI, con: CO }),
  it('Apple Pencil', { sv: 'ApplePen', cat: EL, con: CO, charge: true }),
  it('Targus electronics bag', { sv: 'Targus Elnikväska', cat: EL, con: EB, charge: true, sub: ['iPhone charger', 'iPad charger', 'MacBook Pro charger', 'Apple Watch charger'] }),
  it('AirPods', { sv: 'MS AirPods', cat: EL, con: CO, charge: true }),
  it('AirPods Max', { sv: 'AirPods Max', cat: EL, con: CO, charge: true }),
  it('iPhone tripod', { sv: 'iPhone tripod', cat: EL, con: CO }),
  it('Powerbank', { sv: 'Powerbank', cat: EL, con: CO, charge: true }),
  it('Glasses case', { sv: 'Glasögonfodral', cat: MI, con: CO }),
  it('Sunglasses', { sv: 'Solglasögon', cat: CL, con: CO }),
  it("Anna's glasses", { sv: 'Annas glasögon', cat: MI, con: CO }),
  it('MS reading glasses', { sv: 'MS läsglasögon', cat: MI, con: CO }),
  it('Travel food', { sv: 'Res-mat', cat: FD, con: CO }),
  it('Hobbit food (snacks)', { sv: 'Hobbitmat', cat: FD, con: CO }),
  it('Trail mix', { sv: 'Studentenfutter', cat: FD, con: CO }),
  it('Filled water bottle', { sv: 'Fylld vattenflaska', cat: FD, con: CO }),
  it('Lentils', { sv: 'Linser', cat: FD, con: CK }),
  // Reminders
  it('Pack per the special packing lists (GA / WET)', { sv: 'Packa enligt special-packlistor', cat: REM, rem: true }),
  it('Small plastic tub each for breakfast & dinner (if restaurant food needs topping up)', { sv: 'Plastbyttor mm', cat: REM, rem: true }),
  it('Plastic bags, snack bag etc. for the golf course', { sv: 'Några plastpåsar, Jausesäck etc. till golfbanan', cat: REM, rem: true }),
];

// ---------------------------------------------------------------- Plane (base)
// The flight-specific extras a car/RV trip doesn't need: the carry-on rules stuff.
const PLANE = [
  it('Passport / ID', { sv: 'Pass / ID', cat: DOC, con: CO, ph: 'door', short: true }),
  it('Boarding pass', { sv: 'Boardingkort', cat: DOC, con: CO, ph: 'door' }),
  it('Travel documents (bookings, insurance)', { sv: 'Resedokument (bokningar, försäkring)', cat: DOC, con: CO, ph: 'door' }),
  it('Liquids bag (clear, ≤100 ml)', { sv: 'Vätskepåse (genomskinlig, ≤100 ml)', cat: TO, con: CO, ph: 'daybefore', liquid: true, note: 'Max 100 ml per item, in one clear resealable bag' }),
  it('Power bank (carry-on only)', { sv: 'Powerbank (endast handbagage)', cat: EL, con: CO, ph: 'daybefore', charge: true, restricted: true, note: 'Must travel in carry-on, never checked' }),
  it('Spare batteries (carry-on only)', { sv: 'Reservbatterier (endast handbagage)', cat: EL, con: CO, ph: 'daybefore', restricted: true, note: 'Loose lithium batteries must be in carry-on' }),
  it('Medication (in carry-on)', { sv: 'Mediciner (i handbagaget)', cat: RX, con: CO, ph: 'door' }),
];

// ---------------------------------------------------------------- Car (base)
// The handful of extras that make sense specifically for a road trip.
const CAR = [
  it('Car charger / USB adapter', { sv: 'Billaddare / USB-adapter', cat: EL, con: 'Day pack', charge: true, chargeType: 'usb-a' }),
  it('Phone mount', { sv: 'Mobilhållare', cat: EL, con: 'Day pack' }),
  it('Sunglasses', { sv: 'Solglasögon', cat: MI, con: 'Day pack' }),
  it('Snacks & drinks for the road', { sv: 'Fika & dryck för resan', cat: FD, con: 'Cool box' }),
];

// ---------------------------------------------------------------- RV "Granden" (base)
const BELL = 'Bellroy backpack', RVBOX = 'RV storage box';
const RVBASE = [
  it('Take-along things from the wardrobe', { sv: '"Ta med"-grejor från garderoben', cat: REM, rem: true }),
  // Kläder
  it('Underwear', { sv: 'Trosor / Kalsonger', cat: CL, con: RVBOX }),
  it('Socks', { sv: 'Strumpor', cat: CL, con: RVBOX }),
  it('T-shirts', { sv: 'Tishor', cat: CL, con: RVBOX }),
  it('Trousers', { sv: 'Byxor', cat: CL, con: RVBOX }),
  it('Sweater / fleece', { sv: 'Tröja / fleece', cat: CL, con: RVBOX }),
  it('Base layer', { sv: 'Underställ', cat: CL, con: RVBOX }),
  it('Layer 2 (incl. Woolpower vest)', { sv: 'Lager 2 (inkl. Woolpower-väst)', cat: CL, con: RVBOX }),
  // Skor
  it('Boots', { sv: 'Kängor', cat: FW, con: RVBOX }),
  it('Approach shoes', { sv: 'Approach', cat: FW, con: RVBOX }),
  it('City shoes', { sv: 'Stadsskor', cat: FW, con: RVBOX }),
  it('Teva sandals', { sv: 'Teva sandaler', cat: FW, con: RVBOX, seas: ['Summer'] }),
  // Badrumsartiklar
  it('Contacts', { sv: 'Linser', cat: TO, con: TOI }),
  it('Glasses', { sv: 'Glasögon', cat: MI, con: TOI }),
  it('Contraceptive pill', { sv: 'P-piller', cat: RX, con: TOI }),
  it('Panty liners', { sv: 'Trosskydd', cat: TO, con: TOI }),
  // Bellroy:n (tech backpack)
  it('Targus bag', { sv: 'Targus:en', cat: EL, con: BELL }),
  it('MacBook Pro', { sv: 'MBP', cat: EL, con: BELL, charge: true }),
  it('iPad', { sv: 'Paddor', cat: EL, con: BELL, charge: true }),
  it('AirPods', { sv: 'AirPods', cat: EL, con: BELL, charge: true }),
  it('Garmin Epix Pro', { sv: 'Garmin Epix Pro', cat: EL, con: BELL, charge: true }),
  it('Camera', { sv: 'Kamera', cat: EL, con: BELL, charge: true, sub: ['360°', 'Go2', 'Insta Pro', 'DJI Mini Pro 4', 'DJI Mic 2', 'DJI Neo'] }),
  it('SpaceMouse', { sv: 'SpaceMouse', cat: EL, con: BELL }),
  it('Regular mouse', { sv: 'Vanlig mus', cat: EL, con: BELL }),
  // OE-grejor (other-events gear)
  it('Bromptons (folding bikes)', { sv: 'Bromptons', cat: SG, con: 'Other', sub: ['Bromptons', 'Helmet', 'Lock', 'Alarm', 'Radar', 'Computer', 'Light', 'Pump'] }),
  it('Skis', { sv: 'Skidor', cat: SG, con: 'Other', seas: ['Winter'] }),
  it('Skates', { sv: 'Skridsko', cat: SG, con: 'Other', seas: ['Winter'] }),
  it('Snowshoes', { sv: 'Snöskor', cat: SG, con: 'Other', seas: ['Winter'] }),
  // Composition references
  it('Pack GA gear per special lists (Golf / Hiking / Diving / Climbing)', { sv: 'GA-grejor', cat: REM, rem: true }),
  it('Pack WET gear per special lists (Swim / Bike / Run + winter)', { sv: 'WET-grejor', cat: REM, rem: true }),
  it('Work gear (see work list)', { sv: 'Jobb-grejor / Jobblistan', cat: REM, rem: true }),
];

// Tag items with sensible defaults for weight / flags (#3) by name, so the feature
// has real data out of the box. Everything stays editable per item.
function tagSeed(lists) {
  const any = (n, words) => words.some((w) => n.includes(w));
  const WEIGHTS = { // grams, representative
    'running shoes': 300, 'cycling shoes': 350, 'golf shoes': 500, 'approach shoes': 700,
    boots: 900, 'macbook pro': 1600, ipad: 480, powerbank: 350, clubs: 4000, wetsuit: 900,
    'down jacket': 500, headlamp: 95, 'rain suit': 400, umbrella: 350, laptop: 1500,
  };
  for (const l of lists) {
    for (const it of l.items) {
      const n = it.name.toLowerCase();
      if (any(n, ['underwear', 'socks', 't-shirt', 'boxers', 'bra', 'vests & t-shirts'])) it.perNight = true;
      if (any(n, ['sunscreen', 'shampoo', 'conditioner', 'shower gel', 'body lotion', 'deodorant', 'aftersun',
        'hand sanitizer', 'mosquito', 'toothpaste', 'sun protection', 'lip balm', 'face products',
        'cold-sore', 'cortisone', 'moisturiser', 'balm', 'gel', 'neti pot', 'shower'])) it.liquid = true;
      if (any(n, ['powerbank', 'power pack', 'drone', 'battery', 'batteries', 'whoop', 'e-bike', 'bromptons'])) it.restricted = true;
      for (const k in WEIGHTS) { if (n.includes(k)) { it.weight = WEIGHTS[k]; break; } }
    }
  }
  return lists;
}

// ---------------------------------------------------------------- Diving
// A technical/drysuit diving kit, pre-organised into sections so the list reads as
// a clear overview. Section ids are stable strings referenced by each item's `sec`.
const DS = {
  suit: 'dive-suit', rig: 'dive-rig', reg: 'dive-reg', light: 'dive-light',
  mask: 'dive-mask', instr: 'dive-instr', acc: 'dive-acc', doc: 'dive-doc',
};
const DIVE_SECTIONS = [
  { id: DS.suit,  name: 'Drysuit & exposure' },
  { id: DS.rig,   name: 'Rig / BCD' },
  { id: DS.reg,   name: 'Regulators' },
  { id: DS.light, name: 'Lights' },
  { id: DS.mask,  name: 'Mask & fins' },
  { id: DS.instr, name: 'Instruments & deco' },
  { id: DS.acc,   name: 'Accessories' },
  { id: DS.doc,   name: 'Documents & certification' },
];
const DIVE = [
  // Drysuit & exposure
  it('Drysuit', { cat: SG, con: 'Checked luggage', sec: DS.suit }),
  it('Drysuit undergarment / thermal', { cat: SG, con: 'Checked luggage', sec: DS.suit }),
  it('Drysuit hood', { cat: SG, sec: DS.suit }),
  it('Dry gloves + liners', { cat: SG, sec: DS.suit }),
  it('Drysuit socks', { cat: SG, sec: DS.suit }),
  // Rig / BCD
  it('Backplate + wing', { cat: SG, con: 'Checked luggage', sec: DS.rig }),
  it('Harness + crotch strap', { cat: SG, sec: DS.rig }),
  it('Tank / cam bands', { cat: SG, sec: DS.rig }),
  it('DSMB (surface marker buoy)', { cat: SG, sec: DS.rig }),
  it('Spool / reel', { cat: SG, sec: DS.rig }),
  it('Weight pockets + weights', { cat: SG, con: 'Checked luggage', sec: DS.rig }),
  // Regulators
  it('Primary regulator (1st + 2nd stage)', { cat: SG, sec: DS.reg }),
  it('Backup regulator / long hose', { cat: SG, sec: DS.reg }),
  it('Drysuit inflation hose', { cat: SG, sec: DS.reg }),
  it('Deco / stage regulator', { cat: SG, sec: DS.reg }),
  it('SPG / pressure gauge', { cat: SG, sec: DS.reg }),
  // Lights
  it('Primary canister light', { cat: SG, sec: DS.light, charge: true, restricted: true }),
  it('Backup light 1', { cat: SG, sec: DS.light, restricted: true }),
  it('Backup light 2', { cat: SG, sec: DS.light, restricted: true }),
  it('Tank marker light', { cat: SG, sec: DS.light, restricted: true }),
  it('Video / spotting light', { cat: SG, sec: DS.light, charge: true, restricted: true }),
  // Mask & fins
  it('Mask', { cat: SG, sec: DS.mask }),
  it('Backup mask', { cat: SG, sec: DS.mask }),
  it('Fins', { cat: SG, sec: DS.mask }),
  it('Spring straps', { cat: SG, sec: DS.mask }),
  // Instruments & deco
  it('Dive computer', { cat: EL, sec: DS.instr, charge: true, restricted: true }),
  it('Backup dive computer', { cat: EL, sec: DS.instr, charge: true, restricted: true }),
  it('Compass', { cat: SG, sec: DS.instr }),
  it('Wetnotes + pencil', { cat: SG, sec: DS.instr }),
  it('Cutting tool / line cutter', { cat: SG, sec: DS.instr }),
  // Accessories
  it('Save-a-dive kit (o-rings, tools)', { cat: SG, sec: DS.acc }),
  it('Mask defog', { cat: TO, sec: DS.acc, liquid: true }),
  it('Boots', { cat: FW, sec: DS.acc }),
  it('Reel / wet gloves', { cat: SG, sec: DS.acc }),
  // Documents & certification
  it('Certification card', { cat: DOC, sec: DS.doc }),
  it('Dive logbook', { cat: DOC, sec: DS.doc }),
  it('DAN / dive insurance', { cat: DOC, sec: DS.doc }),
  it('Analyse gas & note MOD', { sv: '', cat: REM, sec: DS.doc, rem: true, ph: 'prep' }),
];

export function seedLists() {
  const L = (name, group, items, extra) => newList({ name, group, builtin: true, items, ...extra });
  return tagSeed([
    // Common base — always included on every trip, whatever the transport / activities.
    L('Travel', '', TRAVEL, { role: 'base' }),
    // Transport bases — auto-included by the trip's "Way of transport": Car brings a
    // few road extras, Plane the carry-on-rules stuff, RV the full motorhome kit.
    L('Car (base)', '', CAR, { role: 'transport', transport: 'Car' }),
    L('Plane (base)', '', PLANE, { role: 'transport', transport: 'Plane' }),
    L('RV Granden (base)', '', RVBASE, { role: 'transport', transport: 'RV' }),
    // GA — Goal Activity
    L('Golf', 'GA', GOLF),
    L('Hiking', 'GA', HIKE),
    L('Diving', 'GA', DIVE, { sections: DIVE_SECTIONS }),
    L('Freediving', 'GA', []),    // scaffold — to fill
    // WET — Workout, Exercise & Training
    L('Swim', 'WET', SWIM),
    L('Bike', 'WET', BIKE),
    L('Run', 'WET', RUN),
    L('Strength', 'WET', []),         // scaffold — to fill
    L('Yoga / Mobility', 'WET', []),  // scaffold — to fill
    L('Breath work', 'WET', []),      // scaffold — to fill
    // OE — Other Events: no packing lists for now (kept as an empty group)
  ]);
}

// (Start-from templates were removed in v30: the common base is always included,
// and the transport radio now auto-adds its own base list — see js/model.js
// listsForEvent — so a separate "start from" preset is no longer needed.)
