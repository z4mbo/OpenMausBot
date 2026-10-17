import { MemberAvatar } from "../OriginPeople";

export type AvatarPerson = { name?: string; username?: string; email: string; avatarUrl?: string | null };

export function PersonAvatar({ person, size = 28 }: { person: AvatarPerson; size?: number }) {
  return <MemberAvatar person={person} size={size} />;
}
