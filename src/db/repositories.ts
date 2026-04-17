import { Db } from './db';
import type { Learner, Enrollment, Lesson, LearnerProgress } from '../types';

export class LearnerRepo {
  constructor(private db: Db) {}
  findById(id: string) {
    return this.db.table<Learner>('learners').findById(id);
  }
  findBySlackUserId(slackUserId: string) {
    return this.db.table<Learner>('learners').findOne({ slackUserId });
  }
  insert(values: Partial<Learner>) {
    return this.db.table<Learner>('learners').insert(values);
  }
  update(id: string, patch: Partial<Learner>) {
    return this.db.table<Learner>('learners').update(id, patch);
  }
}

export class EnrollmentRepo {
  constructor(private db: Db) {}
  findActiveForLearner(learnerId: string) {
    return this.db.table<Enrollment>('enrollment').findOne({ learnerId, status: 'active' });
  }
  findByLearnerAndCourse(learnerId: string, courseId: string) {
    return this.db.table<Enrollment>('enrollment').findOne({ learnerId, courseId });
  }
  insert(values: Partial<Enrollment>) {
    return this.db.table<Enrollment>('enrollment').insert(values);
  }
}

export class LessonRepo {
  constructor(private db: Db) {}

  findById(id: string) {
    return this.db.table<Lesson>('lessons').findById(id);
  }

  async findActiveByCourse(courseId: string): Promise<Lesson[]> {
    const { results } = await this.db
      .raw()
      .prepare(
        `SELECT * FROM lessons WHERE courseId = ? AND (active = 'true' OR status = 'live')
         ORDER BY sequenceNumber ASC`
      )
      .bind(courseId)
      .all<Lesson>();
    return results || [];
  }

  async findNextLesson(courseId: string, currentSequence: number): Promise<Lesson | null> {
    const row = await this.db
      .raw()
      .prepare(
        `SELECT * FROM lessons WHERE courseId = ? AND sequenceNumber > ?
           AND (active = 'true' OR status = 'live')
         ORDER BY sequenceNumber ASC LIMIT 1`
      )
      .bind(courseId, currentSequence)
      .first<Lesson>();
    return row || null;
  }
}

export class ProgressRepo {
  constructor(private db: Db) {}
  findByLearnerId(learnerId: string) {
    return this.db.table<LearnerProgress>('learner_progress').findAll({ learnerId });
  }
  findByLearnerAndLesson(learnerId: string, lessonId: string) {
    return this.db.table<LearnerProgress>('learner_progress').findOne({ learnerId, lessonId });
  }
  async findActiveLesson(learnerId: string): Promise<LearnerProgress | null> {
    const row = await this.db
      .raw()
      .prepare(
        `SELECT * FROM learner_progress WHERE learnerId = ? AND state != 'completed'
         ORDER BY updatedAt DESC LIMIT 1`
      )
      .bind(learnerId)
      .first<LearnerProgress>();
    return row || null;
  }
  insert(values: Partial<LearnerProgress>) {
    return this.db.table<LearnerProgress>('learner_progress').insert(values);
  }
  update(id: string, patch: Partial<LearnerProgress>) {
    return this.db.table<LearnerProgress>('learner_progress').update(id, patch);
  }
}

export interface Repositories {
  learnerRepo: LearnerRepo;
  enrollmentRepo: EnrollmentRepo;
  lessonRepo: LessonRepo;
  progressRepo: ProgressRepo;
}

export function buildRepositories(db: Db): Repositories {
  return {
    learnerRepo: new LearnerRepo(db),
    enrollmentRepo: new EnrollmentRepo(db),
    lessonRepo: new LessonRepo(db),
    progressRepo: new ProgressRepo(db),
  };
}
