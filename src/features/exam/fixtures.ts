import { Exam, DEFAULT_EXAM_CONFIG } from '@/lib/schemas';

/**
 * A sample exam, so the runner can be built and demoed before a backend exists.
 *
 * **This is scaffolding with a deletion date.** Phase B generates blueprints and
 * Phase C generates real exams from them; when `useExam` is wired to the API,
 * this file goes, and the runner should need no other change — which is the
 * property it is here to prove. It is parsed through the `Exam` schema at module
 * load rather than merely typed, so a fixture that drifts from the schema fails
 * immediately and loudly rather than rendering something subtly wrong.
 *
 * The topics are real ones from the AWS material the owner is studying, because
 * a demo of a topic breakdown needs topics that mean something to a viewer.
 *
 * **One question deliberately has no `explanation`.** The field is optional on
 * `McqPayload`, so a generator that omits one — or an older question written
 * before the field was used — is a case the results screen has to handle. A
 * fixture where every question carries one would demo well and prove nothing;
 * q3 is the question that keeps the empty path honest.
 */

const SAMPLE = {
  id: 'sample-exam',
  title: 'AWS Solutions Architect — sample',
  config: { ...DEFAULT_EXAM_CONFIG, questionCount: 6, durationMinutes: 10 },
  questions: [
    {
      id: 'q1',
      topicId: 'networking',
      topicName: 'Networking',
      payload: {
        kind: 'mcq' as const,
        stem: 'A Lambda function in a private subnet must call Amazon S3 without traversing the public internet. Which costs least?',
        options: [
          { text: 'A gateway VPC endpoint for S3', correct: true },
          { text: 'A NAT Gateway in a public subnet', correct: false },
          { text: 'An internet gateway with a route table entry', correct: false },
          { text: 'A NAT instance on t4g.nano', correct: false },
        ],
        explanation:
          'Gateway endpoints for S3 and DynamoDB are free — no hourly charge and no per-GB processing. Every other option here routes through something billed per hour plus per GB, which is why NAT Gateway is the classic wrong answer: it works, and it is the expensive way to make it work.',
      },
    },
    {
      id: 'q2',
      topicId: 'networking',
      topicName: 'Networking',
      payload: {
        kind: 'mcq' as const,
        stem: 'Which statement about security groups is correct?',
        options: [
          { text: 'They are stateful: return traffic is allowed automatically', correct: true },
          { text: 'They are stateless and need explicit outbound rules for replies', correct: false },
          { text: 'They support explicit deny rules', correct: false },
          { text: 'They apply to an entire subnet rather than an interface', correct: false },
        ],
        explanation:
          'Security groups are stateful, so a reply to an allowed inbound request is permitted regardless of outbound rules. Network ACLs are the stateless ones that apply per subnet and support explicit deny — the two are routinely confused, and the exam relies on it.',
      },
    },
    {
      id: 'q3',
      topicId: 'databases',
      topicName: 'Databases',
      payload: {
        kind: 'mcq' as const,
        stem: 'A workload is idle most of the day with brief bursts. Why might Aurora Serverless v2 cost more than a small provisioned RDS instance?',
        options: [
          { text: 'Its minimum ACU capacity bills continuously, even while idle', correct: true },
          { text: 'It charges per connection rather than per hour', correct: false },
          { text: 'It requires Multi-AZ, which doubles the cost', correct: false },
          { text: 'Storage is billed at ten times the standard rate', correct: false },
        ],
      },
    },
    {
      id: 'q4',
      topicId: 'databases',
      topicName: 'Databases',
      payload: {
        kind: 'mcq' as const,
        stem: 'Which is the appropriate choice for storing vector embeddings alongside relational data at low volume?',
        options: [
          { text: 'The pgvector extension in the existing PostgreSQL instance', correct: true },
          { text: 'An Amazon OpenSearch Service domain', correct: false },
          { text: 'A DynamoDB table with a binary attribute', correct: false },
          { text: 'S3 objects queried with Athena', correct: false },
        ],
        explanation:
          'pgvector keeps the embeddings in the database that already holds the rows they describe, so a similarity search and a join are one query. A separate search domain is the right answer at scale and is a second system to run, pay for and keep in sync — at low volume that trade goes the other way.',
      },
    },
    {
      id: 'q5',
      topicId: 'security',
      topicName: 'Security & IAM',
      payload: {
        kind: 'mcq' as const,
        stem: 'A GitHub Actions workflow needs to deploy to AWS. What avoids long-lived credentials entirely?',
        options: [
          { text: 'An IAM role assumed through the GitHub OIDC identity provider', correct: true },
          { text: 'An IAM user access key stored as a repository secret', correct: false },
          { text: 'A root account access key rotated every 90 days', correct: false },
          { text: 'An access key in an encrypted file committed to the repository', correct: false },
        ],
        explanation:
          'OIDC federation exchanges a short-lived GitHub token for temporary AWS credentials, so nothing durable exists to leak. Every other option stores a key somewhere; rotation and encryption reduce the window, they do not remove the secret.',
      },
    },
    {
      id: 'q6',
      topicId: 'cost',
      topicName: 'Cost management',
      payload: {
        kind: 'mcq' as const,
        stem: 'CloudWatch log costs are growing steadily on an otherwise idle account. What is the most likely cause?',
        options: [
          { text: 'Log groups were created with the default never-expire retention', correct: true },
          { text: 'CloudWatch bills per log group regardless of volume', correct: false },
          { text: 'Metric filters are billed per evaluation', correct: false },
          { text: 'Log ingestion is billed twice in multi-AZ deployments', correct: false },
        ],
        explanation:
          'CloudWatch log groups never expire unless retention is set, so storage accrues indefinitely on data nobody reads. It is billed on ingestion and stored volume, not per group — which is why this creeps quietly rather than appearing as a step change.',
      },
    },
  ],
};

/** Parsed, not asserted — a drifted fixture fails at import rather than at render. */
export const SAMPLE_EXAM: Exam = Exam.parse(SAMPLE);
