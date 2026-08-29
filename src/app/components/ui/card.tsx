import type { ComponentPropsWithRef } from "react";

import { cn } from "./cn";

export function Card({ className = "", ...rest }: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-app border border-border bg-surface",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  className = "",
  ...rest
}: ComponentPropsWithRef<"div">) {
  return (
    <div className={cn("flex flex-col gap-1 p-5 pb-0", className)} {...rest} />
  );
}

export function CardTitle({
  className = "",
  ...rest
}: ComponentPropsWithRef<"h3">) {
  return (
    <h3
      className={cn(
        "text-sm font-semibold tracking-tight text-foreground",
        className,
      )}
      {...rest}
    />
  );
}

export function CardDescription({
  className = "",
  ...rest
}: ComponentPropsWithRef<"p">) {
  return (
    <p
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...rest}
    />
  );
}

export function CardContent({
  className = "",
  ...rest
}: ComponentPropsWithRef<"div">) {
  return <div className={cn("p-5", className)} {...rest} />;
}

export function CardFooter({
  className = "",
  ...rest
}: ComponentPropsWithRef<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 p-5 pt-0", className)}
      {...rest}
    />
  );
}
