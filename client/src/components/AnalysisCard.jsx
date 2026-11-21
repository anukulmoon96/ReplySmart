const SENTIMENT_LABELS = { positive: 'Positive', neutral: 'Neutral', negative: 'Tense', mixed: 'Mixed' };

export default function AnalysisCard({ analysis }) {
  if (!analysis) return null;
  const nothingPending = !analysis.pending || /^nothing pending/i.test(analysis.pending);
  return (
    <div className="analysis">
      <div className="analysis-badges">
        <span className={`badge sentiment-${analysis.sentiment}`}>
          {SENTIMENT_LABELS[analysis.sentiment] ?? analysis.sentiment} mood
        </span>
        <span className={`badge urgency-${analysis.urgency}`}>
          {analysis.urgency === 'high' ? 'Reply soon' : `${analysis.urgency} urgency`}
        </span>
      </div>
      <p className="analysis-summary">{analysis.summary}</p>
      {!nothingPending && (
        <div className="analysis-pending">
          <span className="field-label">Waiting on you</span>
          <p>{analysis.pending}</p>
        </div>
      )}
      {analysis.keyPoints?.length > 0 && (
        <ul className="key-points">
          {analysis.keyPoints.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
