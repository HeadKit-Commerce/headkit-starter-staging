"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import type { FaqItem } from "@headkit/sdk";
import { groupFaqsByTopic } from "./faq-groups";

interface FaqListProps {
  faqs: FaqItem[];
}

export function FaqList({ faqs }: FaqListProps): React.JSX.Element {
  const groups = groupFaqsByTopic(faqs);
  const showTopicHeadings = groups.some((g) => g.topic !== null);

  return (
    <div className="flex flex-col gap-12 md:gap-16">
      {groups.map((group) => {
        const mid = Math.ceil(group.items.length / 2);
        const left = group.items.slice(0, mid);
        const right = group.items.slice(mid);
        const key = group.topicSlug ?? "uncategorized";

        return (
          <section
            key={key}
            aria-labelledby={
              showTopicHeadings && group.topic ? `faq-topic-${key}` : undefined
            }
          >
            {showTopicHeadings && group.topic ? (
              <h2
                id={`faq-topic-${key}`}
                className="mb-6 text-2xl font-semibold text-primary md:mb-8 md:text-3xl"
              >
                {group.topic}
              </h2>
            ) : null}
            <div className="grid grid-cols-1 gap-x-12 gap-y-2 md:grid-cols-2">
              <FaqColumn items={left} />
              {right.length > 0 ? <FaqColumn items={right} /> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FaqColumn({ items }: { items: FaqItem[] }): React.JSX.Element {
  return (
    <Accordion type="single" collapsible className="w-full">
      {items.map((faq, index) => (
        <AccordionItem
          key={faq.id ?? index}
          value={faq.id ?? `faq-${index}`}
          className="border-0"
        >
          <AccordionTrigger
            icon="plus-minus"
            className="gap-4 cursor-pointer py-3 text-left text-xl font-semibold text-primary no-underline hover:no-underline hover:opacity-80 md:text-2xl"
          >
            <span className="pr-2">{faq.question}</span>
          </AccordionTrigger>
          <AccordionContent className="pb-4 pt-0">
            {/* Answers are sanitized in getFaqPage before this client boundary. */}
            <div
              className="max-w-md text-base leading-normal text-gray-800 prose prose-p:my-0"
              dangerouslySetInnerHTML={{ __html: faq.answer }}
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
