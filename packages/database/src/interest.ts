import { prisma } from "./client.js";

export type InterestSignupState = "playing" | "kib" | "backup";

export type InterestPostWithSignups = Awaited<ReturnType<typeof getInterestPostById>>;

const signupInclude = {
  signups: { orderBy: { createdAt: "asc" as const } },
} as const;

const INTEREST_STATES: InterestSignupState[] = ["playing", "kib", "backup"];

export function isInterestSignupState(value: string): value is InterestSignupState {
  return INTEREST_STATES.includes(value as InterestSignupState);
}

/**
 * Toggle semantics: clicking the same state removes the user;
 * otherwise move them to the clicked state (exclusive).
 */
export function nextInterestSignupState(
  current: InterestSignupState | null,
  clicked: InterestSignupState,
): InterestSignupState | null {
  if (current === clicked) return null;
  return clicked;
}

export async function getInterestPostById(interestId: string) {
  return prisma.interestPost.findUnique({
    where: { id: interestId },
    include: signupInclude,
  });
}

export async function getInterestPostByMessage(guildId: string, messageId: string) {
  return prisma.interestPost.findFirst({
    where: { guildId, messageId },
    include: signupInclude,
  });
}

export async function createInterestPost(input: {
  guildId: string;
  channelId: string;
  ownerId: string;
  title: string;
  description?: string;
  scriptUrl?: string;
  imageUrl?: string;
  maxPlayers?: number | null;
  messageId?: string | null;
}) {
  return prisma.interestPost.create({
    data: {
      guildId: input.guildId,
      channelId: input.channelId,
      ownerId: input.ownerId,
      title: input.title.trim().slice(0, 100) || "Untitled",
      description: (input.description ?? "").trim().slice(0, 1800),
      scriptUrl: (input.scriptUrl ?? "").trim().slice(0, 500),
      imageUrl: (input.imageUrl ?? "").trim().slice(0, 500),
      maxPlayers:
        input.maxPlayers === undefined || input.maxPlayers === null
          ? null
          : Math.max(1, Math.min(50, Math.floor(input.maxPlayers))),
      messageId: input.messageId ?? null,
      closed: false,
    },
    include: signupInclude,
  });
}

export async function setInterestPostMessageId(interestId: string, messageId: string) {
  return prisma.interestPost.update({
    where: { id: interestId },
    data: { messageId },
    include: signupInclude,
  });
}

export async function updateInterestPost(
  interestId: string,
  data: {
    title?: string;
    description?: string;
    scriptUrl?: string;
    imageUrl?: string;
    maxPlayers?: number | null;
    closed?: boolean;
  },
) {
  return prisma.interestPost.update({
    where: { id: interestId },
    data: {
      ...(data.title !== undefined
        ? { title: data.title.trim().slice(0, 100) || "Untitled" }
        : {}),
      ...(data.description !== undefined
        ? { description: data.description.trim().slice(0, 1800) }
        : {}),
      ...(data.scriptUrl !== undefined
        ? { scriptUrl: data.scriptUrl.trim().slice(0, 500) }
        : {}),
      ...(data.imageUrl !== undefined
        ? { imageUrl: data.imageUrl.trim().slice(0, 500) }
        : {}),
      ...(data.maxPlayers !== undefined
        ? {
            maxPlayers:
              data.maxPlayers === null
                ? null
                : Math.max(1, Math.min(50, Math.floor(data.maxPlayers))),
          }
        : {}),
      ...(data.closed !== undefined ? { closed: data.closed } : {}),
    },
    include: signupInclude,
  });
}

export async function closeInterestPost(interestId: string) {
  return updateInterestPost(interestId, { closed: true });
}

export async function deleteInterestPost(interestId: string) {
  await prisma.interestPost.delete({ where: { id: interestId } });
}

export function getSignupStateForUser(
  post: NonNullable<InterestPostWithSignups>,
  userId: string,
): InterestSignupState | null {
  const row = post.signups.find((s) => s.userId === userId);
  if (!row || !isInterestSignupState(row.state)) return null;
  return row.state;
}

/**
 * Apply toggle/move for a user. Returns the updated post, or null if missing/closed.
 */
export async function setInterestSignup(
  interestId: string,
  userId: string,
  clicked: InterestSignupState,
) {
  const post = await getInterestPostById(interestId);
  if (!post || post.closed) return null;

  const current = getSignupStateForUser(post, userId);
  const next = nextInterestSignupState(current, clicked);

  if (next === null) {
    await prisma.interestSignup.deleteMany({
      where: { interestId, userId },
    });
  } else {
    await prisma.interestSignup.upsert({
      where: { interestId_userId: { interestId, userId } },
      create: { interestId, userId, state: next },
      update: { state: next },
    });
  }

  return getInterestPostById(interestId);
}

export function signupsByState(post: NonNullable<InterestPostWithSignups>) {
  const playing: string[] = [];
  const kib: string[] = [];
  const backup: string[] = [];
  for (const row of post.signups) {
    if (row.state === "playing") playing.push(row.userId);
    else if (row.state === "kib") kib.push(row.userId);
    else if (row.state === "backup") backup.push(row.userId);
  }
  return { playing, kib, backup };
}
