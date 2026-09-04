export function MetricGuide() {
  return (
    <details className="fi-metric-guide">
      <summary>Metric guide &amp; industry reference</summary>
      <div className="fi-metric-guide__body">
        <dl>
          <dt>Sales and credited units</dt>
          <dd>Penetration, per-sale averages, and delivery goals count each delivered sale once. Credited units show your share of split deals separately.</dd>
          <dt>F&I gross per sale (PVR)</dt>
          <dd>Recorded commissionable F&I gross divided by delivered sales. Your entries may exclude finance reserve. Missing gross keeps the result incomplete; an entered $0 is complete.</dd>
          <dt>Products per sale (PPD) and penetration</dt>
          <dd>PPD counts the three tracked products: Service contract, Tire &amp; Wheel, and GAP. Each product’s penetration is its sold count divided by delivered sales. Missing answers remain in that denominator.</dd>
          <dt>Finance Penetration and GAP</dt>
          <dd>Finance Penetration is dealership-arranged financing divided by all delivered sales. Cash and Outside Finance are shown separately when recorded. Older entries without that distinction stay in “Cash / outside not specified.” GAP on Finance sales uses only that payment group; it does not measure product eligibility.</dd>
          <dt>Your baseline</dt>
          <dd>Recent delivered sales provide a personal comparison. Combined totals determine the averages and rates; incomplete entries suppress changes.</dd>
        </dl>
        <p>
          <strong>Industry reference · first half of 2026.</strong>{" "}
          <a href="https://www.se-fi.com/post/stoneeagle-first-half-highs-for-f-i-pvr-f-i-income-per-dealer" target="_blank" rel="noreferrer">StoneEagle reported</a>{" "}
          $1,989 F&I PVR, 1.55 PPD, 45% service contract and 10% Tire &amp; Wheel penetration. Its broader provider sample covers more than half of the U.S. dealer market. These figures are context, not personal targets or like-for-like comparisons: product menus, deal mix and gross definitions differ.{" "}
          <a href="https://www.jmagroup.com/resources/operations/automotive-trends-report" target="_blank" rel="noreferrer">JM&A’s reporting</a>{" "}
          illustrates how industry F&I totals combine product income and finance reserve.
        </p>
      </div>
    </details>
  );
}
