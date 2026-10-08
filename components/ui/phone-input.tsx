"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon } from "@/components/icon";
// /min bundles the reduced libphonenumber metadata set (national formats only)
// — noticeably smaller than the default full metadata. Types not re-exported
// by /min come from the root entry as type-only imports (erased at runtime).
import * as RPNInput from "react-phone-number-input/min";
import type {
  Country,
  Props as RPNInputProps,
  FlagProps,
  Value,
} from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type PhoneInputProps = Omit<
  React.ComponentProps<"input">,
  "onChange" | "value" | "ref"
> &
  Omit<RPNInputProps<typeof RPNInput.default>, "onChange"> & {
    onChange?: (value: Value) => void;
  };

const PhoneInput = React.forwardRef<
  React.ElementRef<typeof RPNInput.default>,
  PhoneInputProps
>(({ className, onChange, value, ...props }, ref) => {
  const normalizedValue = value ? (value as Value) : undefined;

  return (
    <RPNInput.default
      ref={ref}
      className={cn("flex w-full", className)}
      flagComponent={FlagComponent}
      countrySelectComponent={CountrySelect}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputComponent={InputComponent as any}
      smartCaret={false}
      international={false}
      withCountryCallingCode={false}
      {...(normalizedValue !== undefined && { value: normalizedValue })}
      onChange={(val) => onChange?.(val || ("" as Value))}
      {...props}
    />
  );
});
PhoneInput.displayName = "PhoneInput";

const InputComponent = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, ...props }, ref) => (
  <Input
    className={cn(
      "-ml-px rounded-e-lg rounded-s-none border-primary focus-visible:z-10 focus-visible:border-primary focus-visible:ring-primary focus-visible:ring-offset-0 aria-[invalid=true]:border-red-500 aria-[invalid=true]:ring-red-500 disabled:border-neutral-200 autofill:bg-white autofill:[box-shadow:inset_0_0_0_1000px_white]",
      className,
    )}
    {...props}
    ref={ref}
  />
));
InputComponent.displayName = "InputComponent";

type CountryEntry = { label: string; value: Country | undefined };

type CountrySelectProps = {
  disabled?: boolean;
  value: Country;
  options: CountryEntry[];
  onChange: (country: Country) => void;
};

const CountrySelect = ({
  disabled,
  value: selectedCountry,
  options: countryList,
  onChange,
}: CountrySelectProps) => {
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);
  const [searchValue, setSearchValue] = React.useState("");
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <Popover
      open={isOpen}
      modal
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setSearchValue("");
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="flex gap-1 rounded-e-none rounded-s-lg border-primary border-r-0 px-3 focus:z-10"
            disabled={disabled}
          />
        }
      >
        <FlagComponent
          country={selectedCountry}
          countryName={selectedCountry}
        />
        <ChevronsUpDownIcon
          className={cn(
            "-mr-2 h-4 w-4 opacity-50",
            disabled ? "hidden" : "opacity-100",
          )}
        />
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command>
          <CommandInput
            value={searchValue}
            onValueChange={(value) => {
              setSearchValue(value);
              setTimeout(() => {
                if (scrollAreaRef.current) {
                  const viewportElement = scrollAreaRef.current.querySelector(
                    "[data-slot='scroll-area-viewport']",
                  );
                  if (viewportElement) {
                    viewportElement.scrollTop = 0;
                  }
                }
              }, 0);
            }}
            placeholder="Search country..."
          />
          <CommandList>
            <ScrollArea ref={scrollAreaRef} className="h-72">
              <CommandEmpty>No country found.</CommandEmpty>
              <CommandGroup>
                {countryList.map(({ value, label }) =>
                  value ? (
                    <CountrySelectOption
                      key={value}
                      country={value}
                      countryName={label}
                      selectedCountry={selectedCountry}
                      onChange={onChange}
                      onSelectComplete={() => setIsOpen(false)}
                    />
                  ) : null,
                )}
              </CommandGroup>
            </ScrollArea>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

interface CountrySelectOptionProps extends FlagProps {
  selectedCountry: Country;
  onChange: (country: Country) => void;
  onSelectComplete: () => void;
}

const CountrySelectOption = ({
  country,
  countryName,
  selectedCountry,
  onChange,
  onSelectComplete,
}: CountrySelectOptionProps) => {
  const handleSelect = () => {
    onChange(country);
    onSelectComplete();
  };

  return (
    <CommandItem className="gap-2" onSelect={handleSelect}>
      <FlagComponent country={country} countryName={countryName} />
      <span className="flex-1 text-sm">{countryName}</span>
      <span className="text-sm text-neutral-500">{`+${RPNInput.getCountryCallingCode(country)}`}</span>
      <CheckIcon
        className={cn(
          "ml-auto h-4 w-4",
          country === selectedCountry ? "opacity-100" : "opacity-0",
        )}
      />
    </CommandItem>
  );
};

const FlagComponent = ({ country, countryName }: FlagProps) => {
  const Flag = flags[country as keyof typeof flags];

  return (
    <span className="flex h-4 w-6 overflow-hidden rounded-sm bg-neutral-200 [&_svg:not([class*='size-'])]:h-full [&_svg:not([class*='size-'])]:w-full">
      {Flag ? <Flag title={countryName} /> : null}
    </span>
  );
};

export { PhoneInput };
