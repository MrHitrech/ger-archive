import type { Mission } from '../types';

export const isMissionRoot = (mission: Mission) => !mission.parent_mission_id;
export const matchesMissionRank = (mission: Mission | undefined, rank: string) =>
  !rank || (rank === 'challenge' ? mission?.type === 'challenge' : String(mission?.rank) === rank);
export const matchesMissionType = (mission: Mission, type: string) =>
  type === 'all' ||
  (type ? mission.type === type : ['standard', 'tutorial', 'challenge'].includes(mission.type));

export function missionPhases(mission: Mission, missions: Mission[]) {
  const rootId = mission.parent_mission_id || mission.id;
  return missions
    .filter((m) => m.id === rootId || m.parent_mission_id === rootId)
    .sort((a, b) => (a.phase_index || 1) - (b.phase_index || 1));
}
