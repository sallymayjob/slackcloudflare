import type { Lesson } from '../types';

export const SlackBlocks = {
  buildWelcomeMessage(input: { courseId?: string }) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Welcome to RWR LMS*\nCourse: ${input.courseId || ''}` },
      },
    ];
  },

  buildLessonCard(lesson: Partial<Lesson>) {
    const lessonId = String(lesson.id || '');
    const title = String(lesson.title || 'Lesson');
    const contentRef = String(lesson.contentRef || '');
    const objective = String(lesson.objective || '');
    const coreContent = String(lesson.coreContent || '');
    const submitCmd = `/submit ${lessonId} complete`;
    const lessonBody = contentRef
      ? `:books: *Complete the training here:* <${contentRef}|Open Lesson>`
      : `:books: *Lesson content:*\n${coreContent || objective || 'No lesson content provided yet.'}`;

    return [
      { type: 'header', text: { type: 'plain_text', text: title, emoji: true } },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${lessonBody}\n\n:bulb: *Tip:* Take notes as you go — you'll need them for the verification question.`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `When done, type: \`${submitCmd}\` or react with :white_check_mark:`,
        },
      },
      { type: 'context', elements: [{ type: 'mrkdwn', text: lessonId }] },
    ];
  },

  buildProgressSummary(input: {
    completedCount: number;
    overdueCount: number;
    nextAction: string;
  }) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Progress*\nCompleted: ${input.completedCount}\nOverdue: ${input.overdueCount}\nNext: ${input.nextAction}`,
        },
      },
    ];
  },

  buildReminder(input: { learnerId?: string }) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:bell: Reminder for learner ${input.learnerId || ''}` },
      },
    ];
  },

  buildAdminSummary(input: Record<string, unknown>) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Weekly Summary*\n${JSON.stringify(input || {})}` },
      },
    ];
  },

  buildGenericErrorResponse(message?: string) {
    return [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:warning: ${message || 'Unexpected error'}` },
      },
    ];
  },
};

export type SlackBlocksApi = typeof SlackBlocks;
