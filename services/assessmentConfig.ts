export type LikertOptionKey = 'a' | 'b' | 'c' | 'd';

export interface OpenEndedQuestion {
  id: number;
  question: string;
  answerType: 'number' | 'text';
  range?: { min: number; max: number };
}

export interface PersonalityQuestion {
  id: number;
  question: string;
}

export interface ScenarioQuestionOptionMap {
  [key: string]: string;
}

export interface ScenarioQuestion {
  id: number;
  question: string;
  options: ScenarioQuestionOptionMap;
}

export interface EqQuestion {
  id: number;
  question: string;
}

export const OPEN_ENDED_QUESTIONS: OpenEndedQuestion[] = [
  // Note: Q1 (competitiveness 1–10) is handled by the existing slider.
  {
    id: 2,
    question: 'What are three personal traits that help you most in the business world?',
    answerType: 'text',
  },
  {
    id: 3,
    question:
      'Knowing that we all have some weak points, what are two of your weak points that you feel you want to improve on?',
    answerType: 'text',
  },
  {
    id: 4,
    question: 'What are your goals?',
    answerType: 'text',
  },
  {
    id: 5,
    question: 'Describe the \"perfect career\".',
    answerType: 'text',
  },
  {
    id: 6,
    question: 'What are you looking to avoid in a career?',
    answerType: 'text',
  },
  {
    id: 7,
    question: 'What motivates you?',
    answerType: 'text',
  },
  {
    id: 8,
    question: 'How would you describe yourself as an employee?',
    answerType: 'text',
  },
  {
    id: 9,
    question: 'What are three positive things that your last employer would say about you?',
    answerType: 'text',
  },
  {
    id: 10,
    question: 'When were you most satisfied in your job?',
    answerType: 'text',
  },
];

export const PERSONALITY_LIKERT_OPTIONS: Record<
  LikertOptionKey,
  { label: string; score: number }
> = {
  a: { label: 'Strongly Agree', score: 4 },
  b: { label: 'Agree', score: 3 },
  c: { label: 'Disagree', score: 2 },
  d: { label: 'Strongly Disagree', score: 1 },
};

export const PERSONALITY_QUESTIONS: PersonalityQuestion[] = [
  { id: 1, question: 'I am a natural leader.' },
  { id: 2, question: 'One of my goals is to be rich.' },
  {
    id: 3,
    question:
      'I would work harder if I knew I could get public recognition or an award for my efforts.',
  },
  { id: 4, question: 'I look for ways to improve myself.' },
  { id: 5, question: 'It has always been important to me to save money for a rainy day.' },
  { id: 6, question: 'Sometimes it’s important to show who’s the boss.' },
  { id: 7, question: 'I like having a routine.' },
  { id: 8, question: 'You can’t judge success by the size of someone’s bank account.' },
  { id: 9, question: 'I like to be in charge.' },
  {
    id: 10,
    question:
      'The things I value the most have remained pretty much the same throughout my life.',
  },
  {
    id: 11,
    question:
      'I might use my spare time to take a class or read a book to learn more about my profession.',
  },
  { id: 12, question: 'I like to know what’s coming.' },
  {
    id: 13,
    question:
      'I am happy to meet new people at a party where I don’t know anyone.',
  },
  { id: 14, question: 'I like to help others by giving time or money to charity.' },
  {
    id: 15,
    question: 'I usually have at least one hobby that I am working on.',
  },
  {
    id: 16,
    question: 'I have always enjoyed learning how things fit together.',
  },
  { id: 17, question: 'I like art and objects from other cultures.' },
  { id: 18, question: 'I love being able to give to others.' },
  {
    id: 19,
    question:
      'If I had a problem I couldn’t solve on my own, I would seek the advice of a counselor or therapist.',
  },
  { id: 20, question: 'I like vigorous activity.' },
  {
    id: 21,
    question: 'If I’m lost, I always ask someone for directions.',
  },
  {
    id: 22,
    question:
      'If I am shopping for something specific, I appreciate having a sales person help me find the best bargain.',
  },
  {
    id: 23,
    question: 'I look forward to going to work almost every day.',
  },
  {
    id: 24,
    question: 'I think it’s important to explore and learn more about myself.',
  },
  { id: 25, question: 'I’m content with my current career path.' },
];

export const PERSONALITY_TRAIT_GROUPS: Record<string, number[]> = {
  leadership_and_drive: [1, 2, 3, 6, 9],
  growth_and_self_improvement: [4, 11, 16, 24],
  stability_and_security: [5, 7, 10, 12, 25],
  social_and_helping_orientation: [13, 14, 18, 19, 22],
  energy_and_activity_level: [15, 20, 21, 23],
  openness_and_curiosity: [17],
};

export const SCENARIO_QUESTIONS: ScenarioQuestion[] = [
  {
    id: 26,
    question:
      'If you had a choice, which of the following jobs would you choose? A job that has:',
    options: {
      a: 'No supervision or direction',
      b: 'Very little supervision or direction',
      c: 'Some supervision and direction',
      d: 'A lot of supervision and direction',
    },
  },
  {
    id: 27,
    question: 'If you knew you could win a game by cheating, would you?',
    options: {
      a: 'Absolutely',
      b: 'Only if I knew I wouldn’t get caught',
      c: 'Probably not',
      d: 'No',
    },
  },
  {
    id: 28,
    question:
      'Do you enjoy using “how to” books to understand how things work?',
    options: {
      a: 'Absolutely',
      b: 'Sometimes',
      c: 'Not really',
      d: 'No',
    },
  },
  {
    id: 29,
    question:
      'If someone on your block organized a neighborhood social group, would you join?',
    options: {
      a: 'Most definitely',
      b: 'Maybe',
      c: 'Probably not',
      d: 'No',
    },
  },
  {
    id: 30,
    question: 'When it comes to future goals, you like to:',
    options: {
      a: 'Carefully plan them all',
      b: 'Keep my options open',
    },
  },
  {
    id: 31,
    question: 'When making decisions, it’s better to:',
    options: {
      a: 'Go with my gut',
      b: 'Go with the facts',
    },
  },
  {
    id: 32,
    question: 'Most of the time, your workplace is:',
    options: {
      a: 'Immaculate. Everything is in its proper place',
      b: 'Pretty neat. I can find everything',
      c: 'Somewhat messy, but I know which piles to look in when I need to find things',
      d: 'Messy. I keep a lot of clutter around me',
    },
  },
  {
    id: 33,
    question:
      'If you could go to one of the following seminars for free, which would you attend?',
    options: {
      a: 'A step-by-step practical guide to planning your career',
      b: 'Exploring new possibilities and directions with your career',
    },
  },
  {
    id: 34,
    question: 'When solving a problem, you focus most on:',
    options: {
      a: 'The short-term results',
      b: 'The long-term results',
    },
  },
  {
    id: 35,
    question:
      'Imagine that you are the head of a small company. You have to lay off either Sandy, a 15-year employee, or Joanne, who just joined your team last year. They’re equally valuable, though Sandy costs the company a bit more. Who do you let go?',
    options: {
      a: 'Sandy. She’s more expensive and I need to think about the bottom line',
      b: 'Joanne. Sandy deserves loyalty from the company',
    },
  },
  {
    id: 36,
    question: 'You’d rather be described as:',
    options: {
      a: 'Realistic',
      b: 'Imaginative',
    },
  },
  {
    id: 37,
    question:
      'When you’re driving somewhere you’ve only been once before, you:',
    options: {
      a: 'Pull out the map and get the exact directions',
      b: 'Glance at a map, but wing it from there',
      c: 'Rely on my gut. I can always ask for help if I get lost',
    },
  },
  {
    id: 38,
    question:
      'After you attend a meeting, how do you share what you’ve learned with friends or co-workers?',
    options: {
      a: 'I describe every detail of the day from beginning to end',
      b: 'I list off, in detail, the practical information I learned',
      c: 'I tell them how inspiring the key points were',
      d: 'I tell them about the fresh, general approaches we can look forward to in the future',
    },
  },
  {
    id: 39,
    question:
      'When someone comes up with a “new” plan or procedure, you usually think:',
    options: {
      a: 'Irritated. Things run more smoothly with the established procedures',
      b: 'Slightly apprehensive. I might not be comfortable with the new routine',
      c: 'Interested. I like changing things up so that I don’t get bored',
      d: 'Excited. I like staying on the cutting edge and experimenting',
    },
  },
  {
    id: 40,
    question:
      'Imagine your company just instituted a new policy regarding travel expenses — no reimbursements without a receipt. You’re in charge of enforcing it, but an employee forgot the new rule and threw out a $100 receipt. Would you reimburse them?',
    options: {
      a: 'No. Rules are rules',
      b: 'Probably not. It’s unfair to make exceptions to the rule',
      c: 'I might, but I’d remind them of the rule change',
      d: 'Yes. This is a new rule so it’s natural for people to need some adjustment time',
    },
  },
];

export const EQ_LIKERT_OPTIONS: Record<
  LikertOptionKey,
  { label: string; score: number }
> = {
  a: { label: 'Always True', score: 1 },
  b: { label: 'Quite true', score: 2 },
  c: { label: 'Rarely True', score: 3 },
  d: { label: 'Never True', score: 4 },
};

export const EQ_QUESTIONS: EqQuestion[] = [
  {
    id: 1,
    question:
      'I need to know exactly what I’m going to make next year, and the year after that, and the year after that.',
  },
  {
    id: 2,
    question:
      'When I’m working on something, it has my full and complete attention, and I hate having that thought process interrupted by anything or anyone else. I’m a one-thing-at-a-time type of person.',
  },
  {
    id: 3,
    question:
      'If I’m waiting on an offer from a competing company and I have yet to hear what the answer is, I feel incredibly uncomfortable and I hate adrenaline.',
  },
  {
    id: 4,
    question:
      'There is nothing more gratifying than knowing that someone else takes care of automatically depositing my biweekly paycheck into my account. It gives me a warm feeling of safety and regularity.',
  },
  {
    id: 5,
    question:
      'I like the people I work with, and I hope none of them ever leave or move on. In fact, I hope we get to work together for the rest of our lives.',
  },
  {
    id: 6,
    question:
      'I like that my work duties are very clearly spelled out, with no chance for ambiguity or spontaneity, and that nothing can be put on my desk to throw me off my daily, even hourly, routine.',
  },
  {
    id: 7,
    question:
      'If it’s not in my job description, I don’t do it — not because I’m lazy, but because it’s someone else’s job and I wouldn’t want to offend them.',
  },
  {
    id: 8,
    question:
      'Sleep is incredibly important to me. In fact, I’m a grouchy little monster if I get less than my eight hours a night.',
  },
  {
    id: 9,
    question:
      'Work/life balance is so important. True success means a healthy amount of “me time,” for long bubble baths and walks on the beach, enjoying hobbies, and spending quality time.',
  },
  {
    id: 10,
    question: 'I find living a life of extremes to be very stressful.',
  },
];

export const EQ_INTERPRETATION_THRESHOLDS = [
  { min: 32, max: 40, label: 'Strong Entrepreneur / Business Builder' },
  { min: 25, max: 31, label: 'Entrepreneurial-leaning, adaptable' },
  { min: 18, max: 24, label: 'Strong employee, reliable performer' },
  { min: 10, max: 17, label: 'Structure-dependent employee' },
];

