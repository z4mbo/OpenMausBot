import { PublicFeedback } from "@/components/public-feedback";
export const metadata = { title: "Feedback | Origin", robots: { index: false, follow: false } };
export default async function FeedbackPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicFeedback slug={slug} />;
}
