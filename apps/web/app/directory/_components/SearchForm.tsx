"use client";

import { Button, SelectField } from "@ed/ui";
import { useId, useState } from "react";
import styles from "../directory.module.css";

export type SearchOption = { slug: string; name: string };
export type SearchLocality = SearchOption & { countySlug: string };

type Labels = {
  category: string;
  county: string;
  locality: string;
  choose: string;
  wholeCounty: string;
  optional: string;
  submit: string;
  launchGroup: string;
  otherGroup: string;
  suggestedGroup: string;
  allGroup: string;
};

/**
 * The search: three picklists, never a text box (PRD §8: no free-text geography). A plain GET
 * form — it works without JavaScript; with it, the locality list follows the chosen county.
 */
export function SearchForm({
  categories,
  suggested,
  launchCounties,
  otherCounties,
  localities,
  defaults,
  occasionId,
  errors,
  labels,
}: {
  categories: SearchOption[];
  /** Category slugs suggested by the occasion, shown first. */
  suggested: string[];
  launchCounties: SearchOption[];
  otherCounties: SearchOption[];
  /** Localities that have their own page. */
  localities: SearchLocality[];
  defaults: { category?: string; county?: string; locality?: string };
  occasionId?: string | null;
  errors?: { category?: string; county?: string };
  labels: Labels;
}) {
  const id = useId();
  const [county, setCounty] = useState(defaults.county ?? "");
  const here = localities.filter((l) => l.countySlug === county);
  const first = categories.filter((c) => suggested.includes(c.slug)).sort((a, b) => suggested.indexOf(a.slug) - suggested.indexOf(b.slug));
  const rest = categories.filter((c) => !suggested.includes(c.slug));
  return (
    <form action="/directory" method="get" className={styles.search} noValidate>
      {occasionId ? <input type="hidden" name="occasion" value={occasionId} /> : null}
      <SelectField id={`${id}-category`} name="category" label={labels.category} defaultValue={defaults.category ?? ""} error={errors?.category} required>
        <option value="">{labels.choose}</option>
        {first.length > 0 ? (
          <>
            <optgroup label={labels.suggestedGroup}>
              {first.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={labels.allGroup}>
              {rest.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </>
        ) : (
          rest.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))
        )}
      </SelectField>
      <SelectField id={`${id}-county`} name="county" label={labels.county} value={county} onChange={(e) => setCounty(e.target.value)} error={errors?.county} required>
        <option value="">{labels.choose}</option>
        <optgroup label={labels.launchGroup}>
          {launchCounties.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </optgroup>
        <optgroup label={labels.otherGroup}>
          {otherCounties.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </optgroup>
      </SelectField>
      <SelectField
        key={county}
        id={`${id}-locality`}
        name="locality"
        label={labels.locality}
        optionalLabel={labels.optional}
        defaultValue={county === (defaults.county ?? "") ? (defaults.locality ?? "") : ""}
        disabled={here.length === 0}
      >
        <option value="">{labels.wholeCounty}</option>
        {here.map((l) => (
          <option key={l.slug} value={l.slug}>
            {l.name}
          </option>
        ))}
      </SelectField>
      <div className={styles.searchAction}>
        <Button type="submit" variant="primary">
          {labels.submit}
        </Button>
      </div>
    </form>
  );
}
