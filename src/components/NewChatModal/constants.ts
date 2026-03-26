import type { AgentCharacter } from '@/types/electron';

export const CHARACTER_OPTIONS: { id: AgentCharacter; emoji: string; name: string; description: string }[] = [
  { id: 'robot', emoji: '🤖', name: 'Robot', description: 'Classic AI assistant' },
  { id: 'ninja', emoji: '🥷', name: 'Ninja', description: 'Stealthy and efficient' },
  { id: 'wizard', emoji: '🧙', name: 'Wizard', description: 'Magical problem solver' },
  { id: 'astronaut', emoji: '👨‍🚀', name: 'Astronaut', description: 'Space explorer' },
  { id: 'knight', emoji: '⚔️', name: 'Knight', description: 'Noble defender' },
  { id: 'pirate', emoji: '🏴‍☠️', name: 'Pirate', description: 'Adventurous coder' },
  { id: 'alien', emoji: '👽', name: 'Alien', description: 'Out of this world' },
  { id: 'viking', emoji: '🪓', name: 'Viking', description: 'Fearless warrior' },
];

// --- LoL champion names + Data Dragon icon keys (same as Hub) ---

export const CHAMPIONS: { name: string; key: string }[] = [
  { name: 'Aatrox', key: 'Aatrox' }, { name: 'Ahri', key: 'Ahri' }, { name: 'Akali', key: 'Akali' },
  { name: 'Akshan', key: 'Akshan' }, { name: 'Alistar', key: 'Alistar' }, { name: 'Amumu', key: 'Amumu' },
  { name: 'Anivia', key: 'Anivia' }, { name: 'Annie', key: 'Annie' }, { name: 'Aphelios', key: 'Aphelios' },
  { name: 'Ashe', key: 'Ashe' }, { name: 'Azir', key: 'Azir' }, { name: 'Bard', key: 'Bard' },
  { name: 'Blitzcrank', key: 'Blitzcrank' }, { name: 'Brand', key: 'Brand' }, { name: 'Braum', key: 'Braum' },
  { name: 'Caitlyn', key: 'Caitlyn' }, { name: 'Camille', key: 'Camille' }, { name: 'Darius', key: 'Darius' },
  { name: 'Diana', key: 'Diana' }, { name: 'Draven', key: 'Draven' }, { name: 'Ekko', key: 'Ekko' },
  { name: 'Elise', key: 'Elise' }, { name: 'Evelynn', key: 'Evelynn' }, { name: 'Ezreal', key: 'Ezreal' },
  { name: 'Fiora', key: 'Fiora' }, { name: 'Fizz', key: 'Fizz' }, { name: 'Galio', key: 'Galio' },
  { name: 'Garen', key: 'Garen' }, { name: 'Gnar', key: 'Gnar' }, { name: 'Gragas', key: 'Gragas' },
  { name: 'Graves', key: 'Graves' }, { name: 'Gwen', key: 'Gwen' }, { name: 'Hecarim', key: 'Hecarim' },
  { name: 'Heimerdinger', key: 'Heimerdinger' }, { name: 'Illaoi', key: 'Illaoi' }, { name: 'Irelia', key: 'Irelia' },
  { name: 'Ivern', key: 'Ivern' }, { name: 'Janna', key: 'Janna' }, { name: 'Jarvan IV', key: 'JarvanIV' },
  { name: 'Jax', key: 'Jax' }, { name: 'Jayce', key: 'Jayce' }, { name: 'Jhin', key: 'Jhin' },
  { name: 'Jinx', key: 'Jinx' }, { name: "Kai'Sa", key: 'Kaisa' }, { name: 'Karma', key: 'Karma' },
  { name: 'Kassadin', key: 'Kassadin' }, { name: 'Katarina', key: 'Katarina' }, { name: 'Kayn', key: 'Kayn' },
  { name: 'Kennen', key: 'Kennen' }, { name: "Kha'Zix", key: 'Khazix' }, { name: 'Kindred', key: 'Kindred' },
  { name: 'Kled', key: 'Kled' }, { name: 'LeBlanc', key: 'Leblanc' }, { name: 'Leona', key: 'Leona' },
  { name: 'Lillia', key: 'Lillia' }, { name: 'Lissandra', key: 'Lissandra' }, { name: 'Lucian', key: 'Lucian' },
  { name: 'Lulu', key: 'Lulu' }, { name: 'Lux', key: 'Lux' }, { name: 'Malphite', key: 'Malphite' },
  { name: 'Morgana', key: 'Morgana' }, { name: 'Nami', key: 'Nami' }, { name: 'Nasus', key: 'Nasus' },
  { name: 'Nautilus', key: 'Nautilus' }, { name: 'Nidalee', key: 'Nidalee' }, { name: 'Orianna', key: 'Orianna' },
  { name: 'Ornn', key: 'Ornn' }, { name: 'Pantheon', key: 'Pantheon' }, { name: 'Pyke', key: 'Pyke' },
  { name: 'Qiyana', key: 'Qiyana' }, { name: 'Quinn', key: 'Quinn' }, { name: 'Rakan', key: 'Rakan' },
  { name: 'Rammus', key: 'Rammus' }, { name: 'Renata Glasc', key: 'Renata' }, { name: 'Renekton', key: 'Renekton' },
  { name: 'Riven', key: 'Riven' }, { name: 'Rumble', key: 'Rumble' }, { name: 'Ryze', key: 'Ryze' },
  { name: 'Samira', key: 'Samira' }, { name: 'Senna', key: 'Senna' }, { name: 'Seraphine', key: 'Seraphine' },
  { name: 'Sett', key: 'Sett' }, { name: 'Shen', key: 'Shen' }, { name: 'Shyvana', key: 'Shyvana' },
  { name: 'Singed', key: 'Singed' }, { name: 'Sion', key: 'Sion' }, { name: 'Sivir', key: 'Sivir' },
  { name: 'Sona', key: 'Sona' }, { name: 'Soraka', key: 'Soraka' }, { name: 'Swain', key: 'Swain' },
  { name: 'Syndra', key: 'Syndra' }, { name: 'Taliyah', key: 'Taliyah' }, { name: 'Talon', key: 'Talon' },
  { name: 'Taric', key: 'Taric' }, { name: 'Thresh', key: 'Thresh' }, { name: 'Tristana', key: 'Tristana' },
  { name: 'Twisted Fate', key: 'TwistedFate' }, { name: 'Twitch', key: 'Twitch' }, { name: 'Varus', key: 'Varus' },
  { name: 'Vayne', key: 'Vayne' }, { name: 'Veigar', key: 'Veigar' }, { name: 'Vex', key: 'Vex' },
  { name: 'Vi', key: 'Vi' }, { name: 'Viego', key: 'Viego' }, { name: 'Viktor', key: 'Viktor' },
  { name: 'Vladimir', key: 'Vladimir' }, { name: 'Warwick', key: 'Warwick' }, { name: 'Xayah', key: 'Xayah' },
  { name: 'Yasuo', key: 'Yasuo' }, { name: 'Yone', key: 'Yone' }, { name: 'Yorick', key: 'Yorick' },
  { name: 'Yuumi', key: 'Yuumi' }, { name: 'Zed', key: 'Zed' }, { name: 'Zeri', key: 'Zeri' },
  { name: 'Ziggs', key: 'Ziggs' }, { name: 'Zilean', key: 'Zilean' }, { name: 'Zoe', key: 'Zoe' },
  { name: 'Zyra', key: 'Zyra' },
];

const CHAMPION_KEYS = new Map(CHAMPIONS.map(c => [c.name, c.key]));

const DDRAGON_VERSION = '15.6.1';

export function getChampionIconUrl(name: string): string | null {
  const key = CHAMPION_KEYS.get(name);
  if (!key) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${key}.png`;
}

export function getRandomChampion(): { character: AgentCharacter; name: string } {
  const character = CHARACTER_OPTIONS[Math.floor(Math.random() * CHARACTER_OPTIONS.length)];
  const champ = CHAMPIONS[Math.floor(Math.random() * CHAMPIONS.length)];
  return { character: character.id, name: champ.name };
}
