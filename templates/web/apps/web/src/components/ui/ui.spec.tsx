import { render, screen } from '@testing-library/react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';
import { Input } from './input';
import { Label } from './label';

// The catalog, each primitive rendered once: what a page may compose from,
// and what the coverage floor counts.

describe('cn', () => {
  it('joins, and lets the later utility win', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm', undefined, false, 'font-medium')).toBe('text-sm font-medium');
  });
});

describe('Button', () => {
  it('is a button with the default look unless told otherwise', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveClass('bg-accent');
    expect(button).toHaveClass('h-10');
  });

  it('takes a variant and a size from the catalog', () => {
    render(<Button variant="secondary" size="sm">Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button).toHaveClass('border-border');
    expect(button).toHaveClass('h-8');
  });

  it('lends its look to a link with asChild', () => {
    render(<Button asChild><a href="/docs">Docs</a></Button>);
    const link = screen.getByRole('link', { name: 'Docs' });
    expect(link).toHaveClass('inline-flex');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Card', () => {
  it('is a surface with a heading, a description, content and a footer', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>What it is for.</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByText('What it is for.')).toHaveClass('text-muted');
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Foot')).toBeInTheDocument();
  });
});

describe('Input and Label', () => {
  it('tie together by id, and the input is text unless told otherwise', () => {
    render(
      <>
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="Ada" />
      </>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('placeholder', 'Ada');
  });
});
