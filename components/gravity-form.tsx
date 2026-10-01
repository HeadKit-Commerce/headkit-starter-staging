"use client";

import { useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import React, { useEffect, useRef, useState } from "react";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGravityFormById,
  submitGravityForm,
  type GravityFormData,
} from "@/lib/gravity-form-actions";
import {
  snakeCase,
  buildFieldIdByName,
  buildFieldValues,
  type CheckboxFieldSubmission,
} from "@/lib/gravity-form-utils";
import {
  buildFormDefaultValues,
  decodeCheckboxSelection,
  encodeCheckboxSelection,
  hasRenderableChoices,
  isCheckboxChecked,
  isDescriptionAbove,
  isLabelVisible,
  validationMessage,
  type FormChoiceSettings,
} from "@/lib/gravity-form-fields";
import { cn } from "@/lib/utils";
import { subscribeEmailAction } from "@/lib/email-marketing-actions";
import { reportSubscribeOutcome } from "@/lib/subscribe-outcome";
import {
  extractEmailFromFormValues,
  hasMarketingOptIn,
} from "@/lib/email-marketing-utils";

interface GravityFormProps {
  id?: string;
  formId: string;
  initialValues?: { fieldName: string; value: string }[];
  onSubmit?: (values: Record<string, string>) => Promise<void>;
  extraFields?: React.ReactNode;
  buttonClassName?: string;
  disabled?: boolean;
  /**
   * Rendered when the form can't load — Gravity Forms not installed, form id
   * missing, or a fetch error. Lets the storefront degrade gracefully instead
   * of showing a broken/empty form when the plugin is absent.
   */
  fallback?: React.ReactNode;
}

type FieldType =
  | "text"
  | "name"
  | "email"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox";

interface FormFieldConfig {
  type: FieldType;
  label: string;
  isRequired: boolean;
  placeholder?: string | undefined;
  defaultValue: string;
  /** Gravity Forms "Description" — field help text. */
  description?: string | undefined;
  /** Appearance -> Field Label Visibility: "" or "hidden_label". */
  labelPlacement?: string | undefined;
  /** Appearance -> Description Placement, resolved: "above" or "below". */
  descriptionPlacement?: string | undefined;
  /** Appearance -> Custom Validation Message. */
  errorMessage?: string | undefined;
  choices?: FormChoiceSettings[] | undefined;
  databaseId: number;
}

/**
 * Zod schema for the rendered fields.
 *
 * A field's Custom Validation Message replaces the storefront's own copy for
 * EVERY rule on that field, which is how Gravity Forms behaves: one message per
 * field, whatever the failure.
 */
const generateValidationSchema = (fields: FormFieldConfig[]) => {
  const schemaFields: Record<string, z.ZodString> = {};

  fields.forEach((field) => {
    const fieldName = snakeCase(field.label);
    let schema = z.string();

    if (field.isRequired) {
      schema = schema.min(
        1,
        validationMessage(field, `${field.label} is required`),
      );
    }

    if (field.type === "email") {
      schema = schema.email(validationMessage(field, "Invalid email address"));
    }

    schemaFields[fieldName] = schema;
  });

  return z.object(schemaFields);
};

interface RenderFieldProps {
  field: FormFieldConfig;
  control: Control<z.infer<ReturnType<typeof generateValidationSchema>>>;
}

/**
 * The parts of a field that are the same for every type: the label (hidden by
 * Appearance -> Field Label Visibility), the description (above or below the
 * inputs per Appearance -> Description Placement) and the validation message.
 *
 * A hidden label is hidden VISUALLY and kept in the accessibility tree, so the
 * control retains an accessible name. Gravity Forms removes it outright; what a
 * sighted shopper sees is the same either way.
 */
const FieldShell = ({
  field,
  className,
  children,
}: {
  field: FormFieldConfig;
  className?: string;
  children: React.ReactNode;
}) => {
  const description = field.description?.trim();
  const above = isDescriptionAbove(field);

  return (
    <FormItem className={className}>
      <FormLabel className={cn(!isLabelVisible(field) && "sr-only")}>
        {field.label}
      </FormLabel>
      {description && above && <FormDescription>{description}</FormDescription>}
      {children}
      {description && !above && (
        <FormDescription>{description}</FormDescription>
      )}
      <FormMessage />
    </FormItem>
  );
};

const RenderField = ({ field, control }: RenderFieldProps) => {
  const fieldName = snakeCase(field.label);

  switch (field.type) {
    case "text":
    case "name":
    case "email":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FieldShell field={field}>
              <FormControl>
                <Input
                  type={field.type === "email" ? "email" : "text"}
                  placeholder={field.placeholder}
                  {...formField}
                  // React Hook Form holds `undefined` for a field that is not
                  // registered yet — the definition arrives in an effect — and
                  // an input that starts undefined and then gains a value flips
                  // from uncontrolled to controlled, which React warns about and
                  // which loses the first keystroke in some browsers.
                  value={formField.value ?? ""}
                />
              </FormControl>
            </FieldShell>
          )}
        />
      );

    case "textarea":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FieldShell field={field}>
              <FormControl>
                <Textarea
                  placeholder={field.placeholder}
                  className="min-h-[120px]"
                  {...formField}
                  value={formField.value ?? ""}
                />
              </FormControl>
            </FieldShell>
          )}
        />
      );

    case "select":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FieldShell field={field}>
              {/*
                CONTROLLED, not `defaultValue`. The form definition arrives in an
                effect, so at mount this value is still "" and a `defaultValue`
                would be captured empty — which is how an editor-set
                pre-selected choice used to render as the placeholder.
              */}
              <Select
                onValueChange={formField.onChange}
                value={formField.value ?? ""}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={field.placeholder} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {field.choices?.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.text}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldShell>
          )}
        />
      );

    case "radio":
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => (
            <FieldShell field={field} className="space-y-3">
              <FormControl>
                <RadioGroup
                  onValueChange={formField.onChange}
                  value={formField.value ?? ""}
                  className="space-y-1"
                >
                  {field.choices?.map((choice) => (
                    <FormItem
                      key={choice.value}
                      className="flex items-center space-x-3 space-y-0"
                    >
                      <FormControl>
                        <RadioGroupItem value={choice.value} />
                      </FormControl>
                      <FormLabel className="font-normal">
                        {choice.text}
                      </FormLabel>
                    </FormItem>
                  ))}
                </RadioGroup>
              </FormControl>
            </FieldShell>
          )}
        />
      );

    case "checkbox":
      // A Gravity Forms Checkboxes field is N boxes, one per choice. Rendering
      // it as a single box labelled with the FIELD label dropped every choice
      // past the first and submitted a value Gravity Forms reads for nothing.
      if (hasRenderableChoices(field)) {
        return (
          <FormField
            control={control}
            name={fieldName}
            render={({ field: formField }) => {
              const selected = new Set(
                decodeCheckboxSelection(formField.value),
              );
              const toggle = (value: string, checked: boolean) => {
                const next = (field.choices ?? [])
                  .map((choice) => choice.value)
                  .filter((candidate) =>
                    candidate === value ? checked : selected.has(candidate),
                  );
                formField.onChange(encodeCheckboxSelection(next));
              };

              return (
                <FieldShell field={field} className="space-y-3">
                  <div className="space-y-1">
                    {(field.choices ?? []).map((choice) => (
                      <FormItem
                        key={choice.value}
                        className="flex flex-row items-start space-x-3 space-y-0"
                      >
                        <FormControl>
                          <Checkbox
                            checked={selected.has(choice.value)}
                            onCheckedChange={(checked) =>
                              toggle(choice.value, checked === true)
                            }
                          />
                        </FormControl>
                        <FormLabel className="font-normal">
                          {choice.text}
                        </FormLabel>
                      </FormItem>
                    ))}
                  </div>
                </FieldShell>
              );
            }}
          />
        );
      }

      // No choices in the definition: keep the single boolean box, labelled
      // with the field label and submitting "true"/"false". That is what every
      // existing form renders, and what the marketing opt-in path reads.
      return (
        <FormField
          control={control}
          name={fieldName}
          render={({ field: formField }) => {
            const description = field.description?.trim();
            return (
              <FormItem className="space-y-2">
                <div className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={isCheckboxChecked(formField.value)}
                      onCheckedChange={(checked) => {
                        formField.onChange(checked ? "true" : "false");
                      }}
                    />
                  </FormControl>
                  <FormLabel
                    className={cn(
                      "font-normal",
                      !isLabelVisible(field) && "sr-only",
                    )}
                  >
                    {field.label}
                  </FormLabel>
                  <FormMessage />
                </div>
                {description && (
                  <FormDescription>{description}</FormDescription>
                )}
              </FormItem>
            );
          }}
        />
      );

    default:
      return null;
  }
};

const SuccessBox = ({ message }: { message: string }) => (
  <div className="rounded-2xl border-2 border-green-500 p-8">
    <div className="text-center font-medium">{message}</div>
  </div>
);

const GravityFormSkeleton = () => (
  <div className="flex w-full flex-col gap-2">
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-10" />
    <Skeleton className="h-24" />
    <Skeleton className="h-10" />
  </div>
);

export const GravityForm = ({
  id,
  formId,
  initialValues,
  onSubmit,
  extraFields,
  buttonClassName,
  disabled = false,
  fallback,
}: GravityFormProps) => {
  const [message, setMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<GravityFormData | null>(null);

  useEffect(() => {
    const fetchForm = async () => {
      setIsLoading(true);
      try {
        const response = await getGravityFormById(formId);
        setFormData(response);
      } catch (error) {
        setFormData(null);
        console.error("Failed to fetch form:", error);
      }
      setIsLoading(false);
    };
    void fetchForm();
  }, [formId]);

  const injectedFieldNames = new Set(
    (initialValues ?? []).map((v) => v.fieldName),
  );

  // When the host injects product context (enquiry PDP), also suppress common
  // product-attribute field labels even before commerce returns `visibility`.
  // GF Visibility→Hidden still leaves type=text in older API responses.
  const suppressProductContextLabels = injectedFieldNames.size > 0;
  const productContextLabels = new Set([
    "product_name",
    "product_url",
    "product_size",
    "product_colour",
    "product_color",
    "product_options",
    "selected_variations",
    "size",
    "colour",
    "color",
  ]);

  const formFields = (formData?.gfForm?.formFields?.nodes ?? [])
    .map((node) => {
      if (!node?.type || !node?.label) return null;

      // Respect GF Field Visibility (visible|hidden|administrative). This is
      // independent of field type — a Text field with Visibility→Hidden stays
      // type=text in the API and must not render as an input.
      const visibility = (node.visibility ?? "visible").toLowerCase();
      if (visibility === "hidden" || visibility === "administrative") {
        return null;
      }

      const type = node.type.toLowerCase();
      if (
        ![
          "text",
          "name",
          "email",
          "textarea",
          "select",
          "radio",
          "checkbox",
        ].includes(type)
      ) {
        return null;
      }

      const config: FormFieldConfig = {
        type: type as FieldType,
        label: node.label,
        isRequired: Boolean(node.isRequired),
        defaultValue: node.defaultValue ?? "",
        databaseId: node.databaseId,
      };
      if (node.placeholder) config.placeholder = node.placeholder;
      if (node.description) config.description = node.description;
      // Absent on an older commerce build or theme, where every field was
      // label-visible with its description below — which is what the helpers
      // in lib/gravity-form-fields.ts default an absent value to.
      if (node.labelPlacement) config.labelPlacement = node.labelPlacement;
      if (node.descriptionPlacement) {
        config.descriptionPlacement = node.descriptionPlacement;
      }
      if (node.errorMessage) config.errorMessage = node.errorMessage;
      if (node.choices?.nodes?.length) {
        config.choices = node.choices.nodes.map((choice) => ({
          text: choice?.text ?? "",
          value: choice?.value ?? "",
          isSelected: Boolean(choice?.isSelected),
          inputId: choice?.inputId ?? "",
        }));
      }
      return config;
    })
    .filter((field): field is NonNullable<typeof field> => {
      if (field === null) return false;
      const name = snakeCase(field.label);
      if (injectedFieldNames.has(name)) return false;
      if (suppressProductContextLabels && productContextLabels.has(name)) {
        return false;
      }
      return true;
    });

  // Resolve every field's databaseId by snakeCased label across ALL fields —
  // including hidden/injected ones filtered out of the rendered `formFields` —
  // so injected product context submits with its numeric id (ENG-794).
  const fieldIdByName = buildFieldIdByName(formData?.gfForm?.formFields?.nodes);

  // Every Checkboxes field with choices, keyed by its form field name. Gravity
  // Forms reads such a field per choice, so the submission has to be expanded
  // rather than sent as one value — see buildFieldValues.
  const checkboxFields = formFields.reduce<
    Record<string, CheckboxFieldSubmission>
  >((acc, field) => {
    if (field.type === "checkbox" && hasRenderableChoices(field)) {
      acc[snakeCase(field.label)] = { choices: field.choices ?? [] };
    }
    return acc;
  }, {});

  const validationSchema = generateValidationSchema(formFields ?? []);

  // The values the form DEFINITION asks to start with, a choice's editor-set
  // pre-selected tick included. See lib/gravity-form-fields.ts for the rule.
  const definitionDefaults = buildFormDefaultValues(formFields, snakeCase);

  const form = useForm<z.infer<typeof validationSchema>>({
    resolver: zodResolver(validationSchema),
    defaultValues: definitionDefaults,
  });

  // The definition arrives in an EFFECT, so the first render has no fields and
  // `useForm` above captured `{}`. React Hook Form reads `defaultValues` on
  // mount only, so without this the definition's defaults are discarded for
  // every field — measured live: form 2's Email field carries
  // `defaultValue: "{user:user_email}"` and rendered empty.
  //
  // Re-apply them exactly ONCE, keyed on their serialised value, so a later
  // render never clobbers what the shopper has since typed. The effect depends
  // on the JSON rather than the object (new identity every render) and rebuilds
  // the map from it, which also keeps the ref out of the render pass.
  const definitionDefaultsJson = JSON.stringify(definitionDefaults);
  const appliedDefaultsJson = useRef<string | null>(null);
  useEffect(() => {
    if (appliedDefaultsJson.current === definitionDefaultsJson) return;
    appliedDefaultsJson.current = definitionDefaultsJson;
    if (definitionDefaultsJson === "{}") return;
    form.reset(JSON.parse(definitionDefaultsJson) as Record<string, string>);
  }, [definitionDefaultsJson, form]);

  // No form available (Gravity Forms not installed, form id missing, or fetch
  // failed) — render the caller's fallback, or a neutral default.
  if (!isLoading && !formData?.gfForm) {
    return (
      <>
        {fallback ?? (
          <div className="rounded-lg border border-gray-200 p-6 text-center text-sm text-gray-600">
            This form is currently unavailable.
          </div>
        )}
      </>
    );
  }

  if (isLoading) return <GravityFormSkeleton />;

  if (successMessage) {
    return <SuccessBox message={successMessage} />;
  }

  const handleSubmit = async (values: z.infer<typeof validationSchema>) => {
    try {
      setIsSubmitting(true);
      setMessage(null);

      const formattedInitialValues = initialValues
        ?.map((item) => ({ [item.fieldName]: item.value }))
        ?.reduce<
          Record<string, string>
        >((acc, curr) => ({ ...acc, ...curr }), {});
      const allValues = { ...values, ...formattedInitialValues };

      const response = await submitGravityForm({
        id: formId,
        saveAsDraft: false,
        fieldValues: buildFieldValues(allValues, fieldIdByName, checkboxFields),
      });

      // Opt-in mailing list: when a marketing checkbox is checked and an email
      // is present, best-effort subscribe (no-ops if email marketing is off).
      const stringValues = allValues as Record<string, string>;
      if (
        formFields &&
        hasMarketingOptIn(formFields, stringValues, snakeCase)
      ) {
        const email = extractEmailFromFormValues(stringValues);
        if (email) {
          // Non-blocking by design; the handler only records the outcome.
          void reportSubscribeOutcome(
            subscribeEmailAction({ email, source: "form" }),
            { source: "form" },
          );
        }
      }

      if (onSubmit) {
        await onSubmit(values);
      }

      // The confirmation message is stripped to plain text server-side in
      // submitGravityForm (lib/gravity-form-actions.ts) so sanitize-html
      // (~70 KB gz of htmlparser2) stays out of the client bundle (RC-1).
      setSuccessMessage(
        response.submitGfForm?.confirmation?.message ??
          "Form submitted successfully",
      );

      if (typeof window !== "undefined") {
        const dl = (
          window as unknown as { dataLayer?: Array<Record<string, unknown>> }
        ).dataLayer;
        if (dl) {
          dl.push({
            event: "enquire_form",
            ecommerce: {
              item_list_name:
                (values as Record<string, string>).product_name ?? "",
            },
          });
        }
      }

      form.reset();
    } catch (error) {
      const apiError = error as {
        response?: { errors?: { message: string }[] };
      };
      if (apiError.response?.errors?.length) {
        setMessage(
          apiError.response.errors[0]?.message ?? "Something went wrong",
        );
      } else {
        setMessage("Something went wrong");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        id={id ?? "gravityForm"}
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-[20px]"
      >
        {formFields?.map((field) => (
          <RenderField
            key={field.databaseId}
            field={field}
            control={form.control}
          />
        ))}

        {extraFields}

        <Button
          type="submit"
          disabled={disabled || isSubmitting}
          className={buttonClassName}
        >
          {formData?.gfForm?.submitButton?.text ?? "Submit Form"}
        </Button>

        {message && <div className="mt-0.5 flex flex-wrap">{message}</div>}
      </form>
    </Form>
  );
};
